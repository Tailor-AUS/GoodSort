using GoodSort.Api.Data;
using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GoodSort.Api.Endpoints;

public static class BuildingSyndicateEndpoints
{
    public const int BuildingPoolTargetContainers = 1000;
    public const int MaxMessagesPerFiveMinutes = 10;
    public const int AutoHideFlagThreshold = 2;

    public static void MapBuildingSyndicateEndpoints(this WebApplication app)
    {
        // ══════════════════════════════════════════════════════════════════════
        // MEMBER ENDPOINTS (Strictly caller-address-scoped, 100% anonymous)
        // ══════════════════════════════════════════════════════════════════════

        app.MapGet("/api/syndicates/mine", async (HttpContext ctx, GoodSortDbContext db) =>
        {
            var callerId = ctx.GetCallerId();
            if (callerId is null) return Results.Unauthorized();

            var resolved = await ResolveCallerBuildingAsync(callerId.Value, db, createIfEligible: true);
            if (!resolved.Eligible || resolved.Syndicate is null)
            {
                return Results.Ok(new
                {
                    eligible = false,
                    reason = resolved.Reason,
                });
            }

            var payload = await BuildAnonymousSyndicatePayloadAsync(
                resolved.Syndicate,
                callerId.Value,
                ctx.IsAdmin(),
                resolved.BuildingProfiles,
                db);

            return Results.Ok(payload);
        }).RequireAuthorization();

        app.MapPost("/api/syndicates/mine/request-join", async (HttpContext ctx, GoodSortDbContext db) =>
        {
            var callerId = ctx.GetCallerId();
            if (callerId is null) return Results.Unauthorized();

            var resolved = await ResolveCallerBuildingAsync(callerId.Value, db, createIfEligible: true);
            if (!resolved.Eligible || resolved.Syndicate is null)
            {
                return Results.BadRequest(new { error = resolved.Reason ?? "Add a Brisbane building or street address first." });
            }

            var syndicate = resolved.Syndicate;
            if (syndicate.Status == SyndicateStatuses.Paused)
            {
                return Results.BadRequest(new { error = "This building syndicate is currently paused by an administrator." });
            }

            var existing = await db.BuildingSyndicateMembers
                .FirstOrDefaultAsync(m => m.SyndicateId == syndicate.Id && m.ProfileId == callerId.Value);

            if (existing is not null)
            {
                if (existing.Status == SyndicateMemberStatuses.Rejected)
                {
                    // Allow re-requesting cleanly as pending
                    existing.Status = SyndicateMemberStatuses.Pending;
                    existing.JoinedAt = DateTime.UtcNow;
                    syndicate.UpdatedAt = DateTime.UtcNow;
                    await db.SaveChangesAsync();
                }

                var existingPayload = await BuildAnonymousSyndicatePayloadAsync(
                    syndicate, callerId.Value, ctx.IsAdmin(), resolved.BuildingProfiles, db);
                return Results.Ok(existingPayload);
            }

            var existingHandles = (await db.BuildingSyndicateMembers
                .Where(m => m.SyndicateId == syndicate.Id)
                .Select(m => m.AnonHandle)
                .ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var hasApprovedMember = await db.BuildingSyndicateMembers
                .AnyAsync(m => m.SyndicateId == syndicate.Id && m.Status == SyndicateMemberStatuses.Approved);

            var nextNum = existingHandles.Count + 1;
            while (existingHandles.Contains($"Sorter #{nextNum}")) nextNum++;
            var handle = $"Sorter #{nextNum}";
            var isFounder = !hasApprovedMember;

            var member = new BuildingSyndicateMember
            {
                SyndicateId = syndicate.Id,
                ProfileId = callerId.Value,
                AnonHandle = handle,
                Role = isFounder ? SyndicateRoles.Captain : SyndicateRoles.Member,
                Status = isFounder ? SyndicateMemberStatuses.Approved : SyndicateMemberStatuses.Pending,
                ApprovedAt = isFounder ? DateTime.UtcNow : null,
                JoinedAt = DateTime.UtcNow,
            };

            db.BuildingSyndicateMembers.Add(member);
            db.BuildingSyndicateMessages.Add(new BuildingSyndicateMessage
            {
                SyndicateId = syndicate.Id,
                MemberId = member.Id,
                AnonHandle = "System",
                Kind = "system",
                Body = isFounder
                    ? $"{handle} started this anonymous building syndicate."
                    : $"{handle} requested to join this building syndicate.",
            });
            syndicate.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            var payload = await BuildAnonymousSyndicatePayloadAsync(
                syndicate, callerId.Value, ctx.IsAdmin(), resolved.BuildingProfiles, db);
            return Results.Ok(payload);
        }).RequireAuthorization();

        app.MapPost("/api/syndicates/mine/members/{memberId:guid}/decision", async (
            HttpContext ctx,
            Guid memberId,
            SyndicateMemberDecisionRequest req,
            GoodSortDbContext db) =>
        {
            var callerId = ctx.GetCallerId();
            if (callerId is null) return Results.Unauthorized();

            var resolved = await ResolveCallerBuildingAsync(callerId.Value, db, createIfEligible: false);
            if (!resolved.Eligible || resolved.Syndicate is null)
                return Results.NotFound(new { error = "No building syndicate found for your address." });

            var syndicate = resolved.Syndicate;
            var actor = await db.BuildingSyndicateMembers
                .FirstOrDefaultAsync(m => m.SyndicateId == syndicate.Id && m.ProfileId == callerId.Value);

            var canDecide = ctx.IsAdmin()
                || (actor is not null
                    && actor.Status == SyndicateMemberStatuses.Approved
                    && actor.Role == SyndicateRoles.Captain);

            if (!canDecide)
                return Results.Forbid();

            var target = await db.BuildingSyndicateMembers
                .FirstOrDefaultAsync(m => m.Id == memberId && m.SyndicateId == syndicate.Id);
            if (target is null)
                return Results.NotFound(new { error = "Member request not found in this building." });

            var decision = (req.Decision ?? "").Trim().ToLowerInvariant();
            if (decision != "approve" && decision != "reject")
                return Results.BadRequest(new { error = "Decision must be 'approve' or 'reject'." });

            if (decision == "approve")
            {
                target.Status = SyndicateMemberStatuses.Approved;
                target.ApprovedAt = DateTime.UtcNow;
                db.BuildingSyndicateMessages.Add(new BuildingSyndicateMessage
                {
                    SyndicateId = syndicate.Id,
                    MemberId = target.Id,
                    AnonHandle = "System",
                    Kind = "system",
                    Body = $"{target.AnonHandle} joined the building syndicate.",
                });
            }
            else
            {
                target.Status = SyndicateMemberStatuses.Rejected;
            }

            syndicate.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            var payload = await BuildAnonymousSyndicatePayloadAsync(
                syndicate, callerId.Value, ctx.IsAdmin(), resolved.BuildingProfiles, db);
            return Results.Ok(payload);
        }).RequireAuthorization();

        app.MapPost("/api/syndicates/mine/coordination", async (
            HttpContext ctx,
            SyndicateCoordinationRequest req,
            GoodSortDbContext db) =>
        {
            var callerId = ctx.GetCallerId();
            if (callerId is null) return Results.Unauthorized();

            var resolved = await ResolveCallerBuildingAsync(callerId.Value, db, createIfEligible: false);
            if (!resolved.Eligible || resolved.Syndicate is null)
                return Results.NotFound(new { error = "No building syndicate found for your address." });

            var syndicate = resolved.Syndicate;
            if (syndicate.Status == SyndicateStatuses.Paused)
                return Results.BadRequest(new { error = "This building syndicate is paused." });

            var member = await db.BuildingSyndicateMembers
                .FirstOrDefaultAsync(m => m.SyndicateId == syndicate.Id && m.ProfileId == callerId.Value);

            if (member is null || member.Status != SyndicateMemberStatuses.Approved)
                return Results.Forbid();

            var notes = new List<string>();

            if (req.ReadyToPool.HasValue && member.ReadyToPool != req.ReadyToPool.Value)
            {
                member.ReadyToPool = req.ReadyToPool.Value;
                notes.Add(member.ReadyToPool
                    ? $"{member.AnonHandle} marked their bags ready to pool."
                    : $"{member.AnonHandle} paused their ready-to-pool status.");
            }

            if (!string.IsNullOrWhiteSpace(req.DropSpot))
            {
                var spot = req.DropSpot.Trim().ToLowerInvariant();
                if (!SyndicateDropSpots.All.Contains(spot))
                    return Results.BadRequest(new { error = "Invalid drop spot choice." });
                if (member.VotedDropSpot != spot)
                {
                    member.VotedDropSpot = spot;
                    notes.Add($"{member.AnonHandle} voted drop spot: {SyndicateDropSpots.Label(spot)}.");
                }
            }

            if (!string.IsNullOrWhiteSpace(req.PickupWindow))
            {
                var win = req.PickupWindow.Trim().ToLowerInvariant();
                if (!SyndicatePickupWindows.All.Contains(win))
                    return Results.BadRequest(new { error = "Invalid pickup window choice." });
                if (member.VotedPickupWindow != win)
                {
                    member.VotedPickupWindow = win;
                    notes.Add($"{member.AnonHandle} voted pickup window: {SyndicatePickupWindows.Label(win)}.");
                }
            }

            await db.SaveChangesAsync();

            // Recompute consensus drop spot & pickup window across approved members
            var approved = await db.BuildingSyndicateMembers
                .Where(m => m.SyndicateId == syndicate.Id && m.Status == SyndicateMemberStatuses.Approved)
                .ToListAsync();

            var topSpot = approved
                .Where(m => !string.IsNullOrWhiteSpace(m.VotedDropSpot))
                .GroupBy(m => m.VotedDropSpot!)
                .OrderByDescending(g => g.Count())
                .Select(g => g.Key)
                .FirstOrDefault();
            if (topSpot is not null) syndicate.DropSpot = topSpot;

            var topWindow = approved
                .Where(m => !string.IsNullOrWhiteSpace(m.VotedPickupWindow))
                .GroupBy(m => m.VotedPickupWindow!)
                .OrderByDescending(g => g.Count())
                .Select(g => g.Key)
                .FirstOrDefault();
            if (topWindow is not null) syndicate.PickupWindow = topWindow;

            if (req.RequestPickup == true && syndicate.PickupStatus == SyndicatePickupStatuses.None)
            {
                syndicate.PickupStatus = SyndicatePickupStatuses.Requested;
                syndicate.PickupRequestedAt = DateTime.UtcNow;
                syndicate.PickupRequestedByHandle = member.AnonHandle;
                var spotLabel = SyndicateDropSpots.Label(syndicate.DropSpot);
                var winLabel = SyndicatePickupWindows.Label(syndicate.PickupWindow);
                notes.Add($"{member.AnonHandle} requested a building collection ({spotLabel} · {winLabel}).");
            }

            foreach (var note in notes)
            {
                db.BuildingSyndicateMessages.Add(new BuildingSyndicateMessage
                {
                    SyndicateId = syndicate.Id,
                    MemberId = member.Id,
                    AnonHandle = "System",
                    Kind = "system",
                    Body = note,
                });
            }

            syndicate.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            var payload = await BuildAnonymousSyndicatePayloadAsync(
                syndicate, callerId.Value, ctx.IsAdmin(), resolved.BuildingProfiles, db);
            return Results.Ok(payload);
        }).RequireAuthorization();

        app.MapPost("/api/syndicates/mine/messages", async (
            HttpContext ctx,
            SyndicatePostMessageRequest req,
            GoodSortDbContext db) =>
        {
            var callerId = ctx.GetCallerId();
            if (callerId is null) return Results.Unauthorized();

            var resolved = await ResolveCallerBuildingAsync(callerId.Value, db, createIfEligible: false);
            if (!resolved.Eligible || resolved.Syndicate is null)
                return Results.NotFound(new { error = "No building syndicate found for your address." });

            var syndicate = resolved.Syndicate;
            if (syndicate.Status == SyndicateStatuses.Paused)
                return Results.BadRequest(new { error = "This building syndicate is paused." });

            var member = await db.BuildingSyndicateMembers
                .FirstOrDefaultAsync(m => m.SyndicateId == syndicate.Id && m.ProfileId == callerId.Value);

            if (member is null || member.Status != SyndicateMemberStatuses.Approved)
                return Results.Forbid();

            var cleanBody = BuildingAddress.SanitizeMessage(req.Body);
            if (cleanBody is null)
                return Results.BadRequest(new { error = "Message cannot be empty." });

            // Rate limit: max 10 chat messages per 5 minutes per member
            var cutoff = DateTime.UtcNow.AddMinutes(-5);
            var recentCount = await db.BuildingSyndicateMessages
                .CountAsync(m => m.SyndicateId == syndicate.Id
                    && m.MemberId == member.Id
                    && m.Kind == "chat"
                    && m.CreatedAt >= cutoff);

            if (recentCount >= MaxMessagesPerFiveMinutes)
                return Results.Json(new { error = "Slow down — please wait a few minutes before sending more messages." }, statusCode: 429);

            var msg = new BuildingSyndicateMessage
            {
                SyndicateId = syndicate.Id,
                MemberId = member.Id,
                AnonHandle = member.AnonHandle,
                Kind = "chat",
                Body = cleanBody,
            };
            db.BuildingSyndicateMessages.Add(msg);
            syndicate.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                msg.Id,
                msg.AnonHandle,
                msg.Kind,
                msg.Body,
                msg.CreatedAt,
                isMine = true,
            });
        }).RequireAuthorization();

        app.MapPost("/api/syndicates/mine/messages/{messageId:guid}/report", async (
            HttpContext ctx,
            Guid messageId,
            GoodSortDbContext db) =>
        {
            var callerId = ctx.GetCallerId();
            if (callerId is null) return Results.Unauthorized();

            var resolved = await ResolveCallerBuildingAsync(callerId.Value, db, createIfEligible: false);
            if (!resolved.Eligible || resolved.Syndicate is null)
                return Results.NotFound();

            var syndicate = resolved.Syndicate;
            var member = await db.BuildingSyndicateMembers
                .FirstOrDefaultAsync(m => m.SyndicateId == syndicate.Id && m.ProfileId == callerId.Value);

            if (member is null || member.Status != SyndicateMemberStatuses.Approved)
                return Results.Forbid();

            var msg = await db.BuildingSyndicateMessages
                .FirstOrDefaultAsync(m => m.Id == messageId && m.SyndicateId == syndicate.Id && m.Kind == "chat");
            if (msg is null) return Results.NotFound();
            if (msg.MemberId == member.Id)
                return Results.BadRequest(new { error = "You cannot report your own message." });

            msg.Flagged = true;
            msg.FlagCount += 1;
            if (msg.FlagCount >= AutoHideFlagThreshold)
            {
                msg.Hidden = true;
            }
            await db.SaveChangesAsync();

            return Results.Ok(new { reported = true, hidden = msg.Hidden });
        }).RequireAuthorization();

        // ══════════════════════════════════════════════════════════════════════
        // ADMIN ENDPOINTS (Strictly AdminPolicy-gated)
        // ══════════════════════════════════════════════════════════════════════

        app.MapGet("/api/admin/syndicates", async (GoodSortDbContext db) =>
        {
            // Auto-discover any buildings from existing households that aren't tracked yet
            await EnsureDetectedSyndicatesSyncedAsync(db);

            var syndicates = await db.BuildingSyndicates
                .Include(s => s.Members)
                .Include(s => s.Messages)
                .OrderByDescending(s => s.PickupStatus == SyndicatePickupStatuses.Requested)
                .ThenByDescending(s => s.Status == SyndicateStatuses.Official)
                .ThenByDescending(s => s.UpdatedAt)
                .ToListAsync();

            var allHouseholds = await db.Households
                .Include(h => h.Members)
                .ToListAsync();

            var byBuildingKey = new Dictionary<string, List<Profile>>(StringComparer.OrdinalIgnoreCase);
            foreach (var h in allHouseholds)
            {
                var a = BuildingAddress.Analyze(h.Address, h.Suburb, h.Type, h.BuildingName);
                if (string.IsNullOrWhiteSpace(a.BuildingKey)) continue;
                if (!byBuildingKey.TryGetValue(a.BuildingKey, out var list))
                {
                    list = [];
                    byBuildingKey[a.BuildingKey] = list;
                }
                list.AddRange(h.Members);
            }

            var result = syndicates.Select(s =>
            {
                var profiles = byBuildingKey.TryGetValue(s.BuildingKey, out var p) ? p : [];
                var distinctProfiles = profiles.DistinctBy(x => x.Id).ToList();
                var totalContainers = distinctProfiles.Sum(x => x.TotalContainers);
                var flaggedMessages = s.Messages
                    .Where(m => m.Flagged || m.Hidden)
                    .OrderByDescending(m => m.CreatedAt)
                    .Select(m => new { m.Id, m.AnonHandle, m.Body, m.FlagCount, m.Hidden, m.CreatedAt })
                    .ToList();

                return new
                {
                    s.Id,
                    s.BuildingKey,
                    s.DisplayName,
                    s.Suburb,
                    s.BuildingKind,
                    s.Status,
                    s.PickupStatus,
                    s.DropSpot,
                    s.PickupWindow,
                    s.PickupRequestedAt,
                    s.PickupRequestedByHandle,
                    s.OfficialApprovedAt,
                    s.CreatedAt,
                    s.UpdatedAt,
                    totalSortersInBuilding = distinctProfiles.Count,
                    totalContainers,
                    potCents = totalContainers * HouseholdCredit.CentsPerContainer,
                    approvedCount = s.Members.Count(m => m.Status == SyndicateMemberStatuses.Approved),
                    pendingCount = s.Members.Count(m => m.Status == SyndicateMemberStatuses.Pending),
                    readyCount = s.Members.Count(m => m.Status == SyndicateMemberStatuses.Approved && m.ReadyToPool),
                    flaggedCount = flaggedMessages.Count,
                    members = s.Members
                        .OrderBy(m => m.JoinedAt)
                        .Select(m => new
                        {
                            m.Id,
                            m.AnonHandle,
                            m.Role,
                            m.Status,
                            m.ReadyToPool,
                            m.VotedDropSpot,
                            m.VotedPickupWindow,
                            m.JoinedAt,
                        })
                        .ToList(),
                    flaggedMessages,
                };
            }).ToList();

            return Results.Ok(new
            {
                total = result.Count,
                official = result.Count(r => r.Status == SyndicateStatuses.Official),
                detected = result.Count(r => r.Status == SyndicateStatuses.Detected),
                pickupRequested = result.Count(r => r.PickupStatus == SyndicatePickupStatuses.Requested),
                syndicates = result,
            });
        }).RequireAuthorization(AuthHelpers.AdminPolicy);

        app.MapPatch("/api/admin/syndicates/{id:guid}", async (
            Guid id,
            AdminUpdateSyndicateRequest req,
            GoodSortDbContext db) =>
        {
            var syndicate = await db.BuildingSyndicates.FirstOrDefaultAsync(s => s.Id == id);
            if (syndicate is null) return Results.NotFound();

            if (!string.IsNullOrWhiteSpace(req.DisplayName))
                syndicate.DisplayName = req.DisplayName.Trim()[..Math.Min(160, req.DisplayName.Trim().Length)];

            if (!string.IsNullOrWhiteSpace(req.BuildingKind))
            {
                var k = req.BuildingKind.Trim().ToLowerInvariant();
                if (k is "commercial" or "residential" or "mixed") syndicate.BuildingKind = k;
            }

            if (!string.IsNullOrWhiteSpace(req.Status))
            {
                var st = req.Status.Trim().ToLowerInvariant();
                if (!SyndicateStatuses.All.Contains(st))
                    return Results.BadRequest(new { error = "Invalid syndicate status." });

                if (syndicate.Status != st)
                {
                    syndicate.Status = st;
                    if (st == SyndicateStatuses.Official)
                    {
                        syndicate.OfficialApprovedAt ??= DateTime.UtcNow;
                        db.BuildingSyndicateMessages.Add(new BuildingSyndicateMessage
                        {
                            SyndicateId = syndicate.Id,
                            AnonHandle = "System",
                            Kind = "system",
                            Body = "Verified: this building is now an Official Good Sort Syndicate.",
                        });
                    }
                }
            }

            if (!string.IsNullOrWhiteSpace(req.PickupStatus))
            {
                var ps = req.PickupStatus.Trim().ToLowerInvariant();
                if (!SyndicatePickupStatuses.All.Contains(ps))
                    return Results.BadRequest(new { error = "Invalid pickup status." });

                if (syndicate.PickupStatus != ps)
                {
                    syndicate.PickupStatus = ps;
                    if (ps == SyndicatePickupStatuses.Scheduled)
                    {
                        db.BuildingSyndicateMessages.Add(new BuildingSyndicateMessage
                        {
                            SyndicateId = syndicate.Id,
                            AnonHandle = "System",
                            Kind = "system",
                            Body = $"Collection scheduled ({SyndicateDropSpots.Label(syndicate.DropSpot)} · {SyndicatePickupWindows.Label(syndicate.PickupWindow)}). Place QR-tagged bags out on time.",
                        });
                    }
                    else if (ps == SyndicatePickupStatuses.None)
                    {
                        syndicate.PickupRequestedAt = null;
                        syndicate.PickupRequestedByHandle = null;
                    }
                }
            }

            if (!string.IsNullOrWhiteSpace(req.DropSpot) && SyndicateDropSpots.All.Contains(req.DropSpot.Trim().ToLowerInvariant()))
                syndicate.DropSpot = req.DropSpot.Trim().ToLowerInvariant();

            if (!string.IsNullOrWhiteSpace(req.PickupWindow) && SyndicatePickupWindows.All.Contains(req.PickupWindow.Trim().ToLowerInvariant()))
                syndicate.PickupWindow = req.PickupWindow.Trim().ToLowerInvariant();

            syndicate.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new
            {
                syndicate.Id,
                syndicate.DisplayName,
                syndicate.BuildingKind,
                syndicate.Status,
                syndicate.PickupStatus,
                syndicate.DropSpot,
                syndicate.PickupWindow,
                syndicate.OfficialApprovedAt,
            });
        }).RequireAuthorization(AuthHelpers.AdminPolicy);

        app.MapPost("/api/admin/syndicates/{id:guid}/members/{memberId:guid}", async (
            Guid id,
            Guid memberId,
            AdminSyndicateMemberActionRequest req,
            GoodSortDbContext db) =>
        {
            var member = await db.BuildingSyndicateMembers
                .FirstOrDefaultAsync(m => m.Id == memberId && m.SyndicateId == id);
            if (member is null) return Results.NotFound();

            var action = (req.Action ?? "").Trim().ToLowerInvariant();
            switch (action)
            {
                case "approve":
                    member.Status = SyndicateMemberStatuses.Approved;
                    member.ApprovedAt = DateTime.UtcNow;
                    db.BuildingSyndicateMessages.Add(new BuildingSyndicateMessage
                    {
                        SyndicateId = id,
                        MemberId = member.Id,
                        AnonHandle = "System",
                        Kind = "system",
                        Body = $"{member.AnonHandle} joined the building syndicate.",
                    });
                    break;
                case "reject":
                    member.Status = SyndicateMemberStatuses.Rejected;
                    break;
                case "make_captain":
                    member.Status = SyndicateMemberStatuses.Approved;
                    member.ApprovedAt ??= DateTime.UtcNow;
                    member.Role = SyndicateRoles.Captain;
                    db.BuildingSyndicateMessages.Add(new BuildingSyndicateMessage
                    {
                        SyndicateId = id,
                        MemberId = member.Id,
                        AnonHandle = "System",
                        Kind = "system",
                        Body = $"{member.AnonHandle} is now a building captain.",
                    });
                    break;
                default:
                    return Results.BadRequest(new { error = "Action must be approve, reject, or make_captain." });
            }

            await db.SaveChangesAsync();
            return Results.Ok(new { member.Id, member.AnonHandle, member.Role, member.Status });
        }).RequireAuthorization(AuthHelpers.AdminPolicy);

        app.MapPost("/api/admin/syndicates/{id:guid}/messages/{messageId:guid}/moderate", async (
            Guid id,
            Guid messageId,
            AdminModerateMessageRequest req,
            GoodSortDbContext db) =>
        {
            var msg = await db.BuildingSyndicateMessages
                .FirstOrDefaultAsync(m => m.Id == messageId && m.SyndicateId == id);
            if (msg is null) return Results.NotFound();

            var action = (req.Action ?? "").Trim().ToLowerInvariant();
            switch (action)
            {
                case "hide":
                    msg.Hidden = true;
                    break;
                case "restore":
                    msg.Hidden = false;
                    msg.Flagged = false;
                    msg.FlagCount = 0;
                    break;
                case "clear_flag":
                    msg.Flagged = false;
                    msg.FlagCount = 0;
                    break;
                default:
                    return Results.BadRequest(new { error = "Action must be hide, restore, or clear_flag." });
            }

            await db.SaveChangesAsync();
            return Results.Ok(new { msg.Id, msg.Hidden, msg.Flagged, msg.FlagCount });
        }).RequireAuthorization(AuthHelpers.AdminPolicy);
    }

    // ── Internal Helpers ─────────────────────────────────────────────────────

    private sealed record CallerBuildingResolution(
        bool Eligible,
        string? Reason,
        BuildingSyndicate? Syndicate,
        List<Profile> BuildingProfiles);

    private static async Task<CallerBuildingResolution> ResolveCallerBuildingAsync(
        Guid callerId,
        GoodSortDbContext db,
        bool createIfEligible)
    {
        var caller = await db.Profiles
            .Include(p => p.Household)
            .FirstOrDefaultAsync(p => p.Id == callerId);

        if (caller?.Household is null || string.IsNullOrWhiteSpace(caller.Household.Address))
        {
            return new CallerBuildingResolution(false, "Add your address to check for a building syndicate.", null, []);
        }

        var analysis = BuildingAddress.Analyze(
            caller.Household.Address,
            caller.Household.Suburb,
            caller.Household.Type,
            caller.Household.BuildingName);

        if (string.IsNullOrWhiteSpace(analysis.BuildingKey))
        {
            return new CallerBuildingResolution(false, "Add a street number so we can match your building.", null, []);
        }

        // Gather all profiles whose household maps to the same BuildingKey (filtered by suburb first when set)
        var hhQuery = db.Households.Include(h => h.Members).AsQueryable();
        if (!string.IsNullOrWhiteSpace(analysis.Suburb))
        {
            var sub = analysis.Suburb;
            hhQuery = hhQuery.Where(h => h.Suburb == sub || h.Suburb == null || h.Suburb == "");
        }

        var candidateHouseholds = await hhQuery.ToListAsync();
        var matchingProfiles = candidateHouseholds
            .Where(h => string.Equals(
                BuildingAddress.Analyze(h.Address, h.Suburb, h.Type, h.BuildingName).BuildingKey,
                analysis.BuildingKey,
                StringComparison.OrdinalIgnoreCase))
            .SelectMany(h => h.Members)
            .DistinctBy(p => p.Id)
            .ToList();

        var existingSyndicate = await db.BuildingSyndicates
            .FirstOrDefaultAsync(s => s.BuildingKey == analysis.BuildingKey);

        // Qualifies if commercial/multi-unit building detected OR 2+ sorters share the address OR already tracked
        var qualifies = existingSyndicate is not null
            || analysis.IsMultiUnitOrCommercial
            || matchingProfiles.Count >= 2;

        if (!qualifies)
        {
            return new CallerBuildingResolution(false, "Single-house address (no other sorters at this street number yet).", null, matchingProfiles);
        }

        if (existingSyndicate is null && createIfEligible)
        {
            var candidate = new BuildingSyndicate
            {
                BuildingKey = analysis.BuildingKey,
                DisplayName = analysis.DisplayName,
                Suburb = analysis.Suburb,
                BuildingKind = analysis.BuildingKind,
                Status = SyndicateStatuses.Detected,
                PickupStatus = SyndicatePickupStatuses.None,
            };
            db.BuildingSyndicates.Add(candidate);
            try
            {
                await db.SaveChangesAsync();
                existingSyndicate = candidate;
            }
            catch (DbUpdateException)
            {
                db.Entry(candidate).State = EntityState.Detached;
                existingSyndicate = await db.BuildingSyndicates
                    .FirstOrDefaultAsync(s => s.BuildingKey == analysis.BuildingKey);
            }
        }

        return new CallerBuildingResolution(existingSyndicate is not null, null, existingSyndicate, matchingProfiles);
    }

    private static async Task EnsureDetectedSyndicatesSyncedAsync(GoodSortDbContext db)
    {
        var households = await db.Households.Include(h => h.Members).ToListAsync();
        var groups = households
            .Select(h => (Household: h, Analysis: BuildingAddress.Analyze(h.Address, h.Suburb, h.Type, h.BuildingName)))
            .Where(x => !string.IsNullOrWhiteSpace(x.Analysis.BuildingKey))
            .GroupBy(x => x.Analysis.BuildingKey!, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var existingKeys = (await db.BuildingSyndicates.Select(s => s.BuildingKey).ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var added = false;
        foreach (var g in groups)
        {
            if (existingKeys.Contains(g.Key)) continue;
            var distinctMembers = g.SelectMany(x => x.Household.Members).DistinctBy(p => p.Id).Count();
            var anyMulti = g.Any(x => x.Analysis.IsMultiUnitOrCommercial);
            if (!anyMulti && distinctMembers < 2) continue;

            var rep = g.First().Analysis;
            db.BuildingSyndicates.Add(new BuildingSyndicate
            {
                BuildingKey = g.Key,
                DisplayName = rep.DisplayName,
                Suburb = rep.Suburb,
                BuildingKind = rep.BuildingKind,
                Status = SyndicateStatuses.Detected,
                PickupStatus = SyndicatePickupStatuses.None,
            });
            added = true;
        }

        if (added) await db.SaveChangesAsync();
    }

    private static async Task<object> BuildAnonymousSyndicatePayloadAsync(
        BuildingSyndicate syndicate,
        Guid callerId,
        bool isAdmin,
        List<Profile> buildingProfiles,
        GoodSortDbContext db)
    {
        var allMembers = await db.BuildingSyndicateMembers
            .Where(m => m.SyndicateId == syndicate.Id)
            .OrderBy(m => m.JoinedAt)
            .ToListAsync();

        var myMember = allMembers.FirstOrDefault(m => m.ProfileId == callerId);
        var approvedMembers = allMembers.Where(m => m.Status == SyndicateMemberStatuses.Approved).ToList();
        var pendingMembers = allMembers.Where(m => m.Status == SyndicateMemberStatuses.Pending).ToList();

        var totalSortersInBuilding = Math.Max(buildingProfiles.Count, approvedMembers.Count);
        var otherSortersCount = Math.Max(0, totalSortersInBuilding - 1);
        var totalContainers = buildingProfiles.Sum(p => p.TotalContainers);
        var myContainers = buildingProfiles.FirstOrDefault(p => p.Id == callerId)?.TotalContainers ?? 0;
        var mySharePct = totalContainers > 0 ? (int)Math.Round(myContainers * 100.0 / totalContainers) : 0;

        var dropSpotVotes = SyndicateDropSpots.All.ToDictionary(
            spot => spot,
            spot => approvedMembers.Count(m => m.VotedDropSpot == spot));

        var pickupWindowVotes = SyndicatePickupWindows.All.ToDictionary(
            win => win,
            win => approvedMembers.Count(m => m.VotedPickupWindow == win));

        var isApprovedMember = myMember is not null && myMember.Status == SyndicateMemberStatuses.Approved;
        var canModeratePending = isAdmin || (isApprovedMember && myMember!.Role == SyndicateRoles.Captain);

        var messages = isApprovedMember
            ? await db.BuildingSyndicateMessages
                .Where(m => m.SyndicateId == syndicate.Id && !m.Hidden)
                .OrderByDescending(m => m.CreatedAt)
                .Take(60)
                .OrderBy(m => m.CreatedAt)
                .Select(m => new
                {
                    m.Id,
                    m.AnonHandle,
                    m.Kind,
                    m.Body,
                    m.CreatedAt,
                    isMine = myMember != null && m.MemberId == myMember.Id,
                })
                .ToListAsync()
            : [];

        var slug = BuildingAddress.Slugify(syndicate.DisplayName);

        return new
        {
            eligible = true,
            syndicate = new
            {
                syndicate.Id,
                syndicate.DisplayName,
                channelName = $"#{slug}",
                syndicate.Suburb,
                syndicate.BuildingKind,
                syndicate.Status,
                syndicate.PickupStatus,
                syndicate.DropSpot,
                syndicate.PickupWindow,
                syndicate.PickupRequestedAt,
                syndicate.PickupRequestedByHandle,
                syndicate.OfficialApprovedAt,
                targetContainers = BuildingPoolTargetContainers,
                totalSortersInBuilding,
                otherSortersCount,
                approvedMembersCount = approvedMembers.Count,
                pendingRequestsCount = pendingMembers.Count,
                readyCount = approvedMembers.Count(m => m.ReadyToPool),
                totalContainers,
                potCents = totalContainers * HouseholdCredit.CentsPerContainer,
                dropSpotVotes,
                pickupWindowVotes,
            },
            myMembership = new
            {
                memberId = myMember?.Id,
                anonHandle = myMember?.AnonHandle,
                role = myMember?.Role ?? "none",
                status = myMember?.Status ?? "none",
                readyToPool = myMember?.ReadyToPool ?? false,
                votedDropSpot = myMember?.VotedDropSpot,
                votedPickupWindow = myMember?.VotedPickupWindow,
                myContainers,
                mySharePct,
                canApprovePending = canModeratePending,
            },
            // STRICT ZERO-PII: only neutral AnonHandles ever leave the server
            members = isApprovedMember
                ? approvedMembers.Select(m => new
                {
                    m.Id,
                    m.AnonHandle,
                    m.Role,
                    m.ReadyToPool,
                    isMe = m.ProfileId == callerId,
                }).ToList()
                : [],
            pendingRequests = canModeratePending
                ? pendingMembers.Select(m => new
                {
                    m.Id,
                    m.AnonHandle,
                    m.JoinedAt,
                }).ToList()
                : [],
            messages,
        };
    }
}

public record SyndicateMemberDecisionRequest(string Decision);
public record SyndicateCoordinationRequest(bool? ReadyToPool = null, string? DropSpot = null, string? PickupWindow = null, bool? RequestPickup = null);
public record SyndicatePostMessageRequest(string Body);
public record AdminUpdateSyndicateRequest(string? DisplayName = null, string? BuildingKind = null, string? Status = null, string? PickupStatus = null, string? DropSpot = null, string? PickupWindow = null);
public record AdminSyndicateMemberActionRequest(string Action);
public record AdminModerateMessageRequest(string Action);
