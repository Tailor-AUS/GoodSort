using System.Text.RegularExpressions;

namespace GoodSort.Api.Tests;

/// <summary>
/// "Is this a house" must be decided the same way everywhere.
///
/// The migration that added Household.Type used defaultValue "", so legacy rows
/// carry an empty Type. When WaitlistDensity was changed to treat those as
/// houses but the queries elsewhere still matched == "residential", a legacy
/// household would have COUNTED toward its suburb's run while being invisible
/// to /api/admin/waitlist, impossible to allocate bins to, never emailed and
/// never sent a bag-out reminder. It would have inflated demand and been
/// uncollectable — precisely the "driver sent to an empty street" outcome the
/// dispatch guard exists to prevent.
///
/// A half-converted codebase is worse than either consistent choice, so this
/// fails the build rather than waiting to be noticed in production.
/// </summary>
public class ResidentialRuleConsistencyTests
{
    static string RepoFile(params string[] parts)
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !Directory.Exists(Path.Combine(dir, "src", "GoodSort.Api")))
            dir = Directory.GetParent(dir)?.FullName;
        Assert.NotNull(dir);
        return Path.Combine(new[] { dir!, "src", "GoodSort.Api" }.Concat(parts).ToArray());
    }

    public static TheoryData<string[]> SourceFiles => new()
    {
        new[] { "Program.cs" },
        new[] { "Services", "NotificationService.cs" },
        new[] { "Services", "PickupReminderService.cs" },
        new[] { "Services", "WaitlistDensity.cs" },
    };

    [Theory]
    [MemberData(nameof(SourceFiles))]
    public void No_query_filters_on_type_equalling_residential(string[] parts)
    {
        var path = RepoFile(parts);
        Assert.True(File.Exists(path), $"expected {path} to exist");
        var source = File.ReadAllText(path);

        // Comparisons only. `Type = "residential"` (assignment / default) is
        // fine and intended — that is what a NEW household should be.
        var comparisons = Regex.Matches(source, @"Type\s*(==|!=)\s*""residential""");

        Assert.True(comparisons.Count == 0,
            $"{Path.GetFileName(path)} compares Type against \"residential\" {comparisons.Count} time(s). "
            + "Legacy rows have an empty Type from the migration default, so that silently excludes them. "
            + "Use != \"unit_complex\" (see WaitlistDensity.IsResidential).");
    }
}
