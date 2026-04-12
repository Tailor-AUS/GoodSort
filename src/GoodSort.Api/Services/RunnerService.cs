using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Services;

public class RunnerService
{
    private readonly GoodSortDbContext _db;

    public RunnerService(GoodSortDbContext db)
    {
        _db = db;
    }

    // ── Level Thresholds ──────────────────────────────────────────────────

    private static readonly Dictionary<string, (int runs, double rating, int streak)> LevelThresholds = new()
    {
        ["bronze"] = (0, 0, 0),
        ["silver"] = (20, 4.0, 0),
        ["gold"] = (100, 4.3, 10),
        ["platinum"] = (500, 4.6, 30),
    };

    // ── Badge Definitions ─────────────────────────────────────────────────

    private static readonly Dictionary<string, Func<RunnerProfile, bool>> BadgeChecks = new()
    {
        ["first_run"] = rp => rp.TotalRuns >= 1,
        ["ten_runs"] = rp => rp.TotalRuns >= 10,
        ["fifty_runs"] = rp => rp.TotalRuns >= 50,
        ["century_runner"] = rp => rp.TotalRuns >= 100,
        ["1k_containers"] = rp => rp.TotalContainersCollected >= 1000,
        ["5k_containers"] = rp => rp.TotalContainersCollected >= 5000,
        ["week_streak"] = rp => rp.LongestStreakDays >= 7,
        ["month_streak"] = rp => rp.LongestStreakDays >= 30,
    };

    // ── Rating Calculation ────────────────────────────────────────────────

    /// <summary>
    /// Generate a platform-computed rating for a completed run.
    /// 40% pickup completeness + 30% timeliness + 30% bag condition
    /// </summary>
    public async Task<RunnerRating> GenerateRating(Run run)
    {
        var stops = await _db.RunStops.Where(s => s.RunId == run.Id).ToListAsync();
        var totalStops = stops.Count;
        var pickedUp = stops.Count(s => s.Status == "picked_up");

        // Pickup completeness: stops picked up / total
        var completeness = totalStops > 0 ? (double)pickedUp / totalStops : 1.0;

        // Timeliness: within estimated duration × 1.25
        var actualMinutes = run.StartedAt.HasValue && run.CompletedAt.HasValue
            ? (run.CompletedAt.Value - run.StartedAt.Value).TotalMinutes
            : run.EstimatedDurationMin;
        var allowedMinutes = run.EstimatedDurationMin * 1.25;
        var timeliness = actualMinutes <= allowedMinutes
            ? 1.0
            : Math.Max(0.0, 1.0 - (actualMinutes - allowedMinutes) / allowedMinutes);

        // Bag condition: default 1.0 (no contamination reports yet — will be adjusted manually)
        var bagCondition = 1.0;

        // Weighted overall
        var overall = completeness * 0.4 + timeliness * 0.3 + bagCondition * 0.3;

        // Map to 1-5 stars
        var stars = overall >= 0.9 ? 5 : overall >= 0.75 ? 4 : overall >= 0.6 ? 3 : overall >= 0.4 ? 2 : 1;

        var rating = new RunnerRating
        {
            RunId = run.Id,
            RunnerId = run.RunnerId!.Value,
            PickupCompleteness = completeness,
            Timeliness = timeliness,
            BagCondition = bagCondition,
            OverallScore = overall,
            Stars = stars,
        };

        _db.RunnerRatings.Add(rating);
        return rating;
    }

    // ── Update Runner Stats ───────────────────────────────────────────────

    /// <summary>
    /// Update runner profile after a completed run: stats, streak, efficiency, level, badges.
    /// </summary>
    public async Task UpdateRunnerStats(Run run)
    {
        if (run.RunnerId == null) return;

        var runner = await _db.RunnerProfiles.FindAsync(run.RunnerId.Value);
        if (runner == null) return;

        // Update totals
        runner.TotalRuns++;
        runner.TotalContainersCollected += run.ActualContainers;
        runner.LifetimeEarningsCents += run.ActualPayoutCents;

        // Update streak
        UpdateStreak(runner);

        // Update efficiency (containers/hour EMA, α=0.3)
        if (run.StartedAt.HasValue && run.CompletedAt.HasValue)
        {
            var hours = (run.CompletedAt.Value - run.StartedAt.Value).TotalHours;
            if (hours > 0)
            {
                var runEfficiency = run.ActualContainers / hours;
                runner.EfficiencyScore = runner.EfficiencyScore == 0
                    ? runEfficiency
                    : runner.EfficiencyScore * 0.7 + runEfficiency * 0.3;
            }
        }

        // Update rolling average rating
        var latestRating = await _db.RunnerRatings
            .Where(rr => rr.RunnerId == runner.Id)
            .OrderByDescending(rr => rr.CreatedAt)
            .FirstOrDefaultAsync();

        if (latestRating != null)
        {
            runner.TotalRatings++;
            runner.Rating = runner.TotalRatings == 1
                ? latestRating.Stars
                : (runner.Rating * (runner.TotalRatings - 1) + latestRating.Stars) / runner.TotalRatings;
        }

        // Check level progression
        UpdateLevel(runner);

        // Check new badges
        UpdateBadges(runner, run);

        runner.LastRunCompletedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    // ── Streak ────────────────────────────────────────────────────────────

    private static void UpdateStreak(RunnerProfile runner)
    {
        if (runner.LastRunCompletedAt == null)
        {
            runner.CurrentStreakDays = 1;
            runner.LongestStreakDays = 1;
            return;
        }

        var hoursSinceLastRun = (DateTime.UtcNow - runner.LastRunCompletedAt.Value).TotalHours;

        if (hoursSinceLastRun <= 36) // 1.5 day grace period
        {
            // Only increment if it's a new calendar day
            if (runner.LastRunCompletedAt.Value.Date < DateTime.UtcNow.Date)
                runner.CurrentStreakDays++;
        }
        else
        {
            runner.CurrentStreakDays = 1; // Reset streak
        }

        runner.LongestStreakDays = Math.Max(runner.LongestStreakDays, runner.CurrentStreakDays);
    }

    // ── Level ─────────────────────────────────────────────────────────────

    private static void UpdateLevel(RunnerProfile runner)
    {
        if (runner.TotalRuns >= 500 && runner.Rating >= 4.6 && runner.LongestStreakDays >= 30)
            runner.Level = "platinum";
        else if (runner.TotalRuns >= 100 && runner.Rating >= 4.3 && runner.LongestStreakDays >= 10)
            runner.Level = "gold";
        else if (runner.TotalRuns >= 20 && runner.Rating >= 4.0)
            runner.Level = "silver";
        else
            runner.Level = "bronze";
    }

    // ── Badges ────────────────────────────────────────────────────────────

    private void UpdateBadges(RunnerProfile runner, Run run)
    {
        foreach (var (badge, check) in BadgeChecks)
        {
            if (!runner.Badges.Contains(badge) && check(runner))
                runner.Badges.Add(badge);
        }

        // Special badges that need run context
        if (run.StartedAt.HasValue && run.StartedAt.Value.Hour < 7 && !runner.Badges.Contains("early_bird"))
            runner.Badges.Add("early_bird");

        if (run.EstimatedDurationMin > 0 && run.StartedAt.HasValue && run.CompletedAt.HasValue)
        {
            var actualMin = (run.CompletedAt.Value - run.StartedAt.Value).TotalMinutes;
            if (actualMin < run.EstimatedDurationMin * 0.75 && !runner.Badges.Contains("speed_demon"))
                runner.Badges.Add("speed_demon");
        }

        // Perfect run: all stops picked up, 5-star rating
        var rating = _db.RunnerRatings.Local.FirstOrDefault(rr => rr.RunId == run.Id);
        if (rating?.Stars == 5 && !runner.Badges.Contains("perfect_run"))
            runner.Badges.Add("perfect_run");
    }

    // ── Leaderboard ───────────────────────────────────────────────────────

    public async Task<List<LeaderboardEntry>> GetLeaderboard(string period = "all", int limit = 20)
    {
        var query = _db.RunnerProfiles
            .Include(rp => rp.Profile)
            .AsQueryable();

        // For weekly/monthly we'd filter by runs completed in period, but for MVP use lifetime stats
        var runners = await query
            .OrderByDescending(rp => rp.TotalContainersCollected)
            .Take(limit)
            .Select(rp => new LeaderboardEntry
            {
                RunnerId = rp.Id,
                Name = rp.Profile.Name,
                Level = rp.Level,
                TotalContainers = rp.TotalContainersCollected,
                TotalRuns = rp.TotalRuns,
                Rating = rp.Rating,
                EfficiencyScore = rp.EfficiencyScore,
            })
            .ToListAsync();

        // Assign rank
        for (var i = 0; i < runners.Count; i++)
            runners[i].Rank = i + 1;

        return runners;
    }
}

public class LeaderboardEntry
{
    public int Rank { get; set; }
    public Guid RunnerId { get; set; }
    public string Name { get; set; } = "";
    public string Level { get; set; } = "bronze";
    public int TotalContainers { get; set; }
    public int TotalRuns { get; set; }
    public double Rating { get; set; }
    public double EfficiencyScore { get; set; }
}
