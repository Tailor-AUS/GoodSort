using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// Who the recovery email may reach, and — more importantly — who it may not.
///
/// The gap it exists for: SendWaitlistProgress selects members whose household
/// suburb equals the suburb that moved, so a member with no canonical suburb
/// matches no query in NotificationService at all. They sign up, they scan,
/// their credit is real, and nothing ever reaches them again unless they
/// happen to come back to the site themselves. Production has one.
///
/// The risk in fixing that is emailing people who should not be emailed, so
/// most of these tests are about exclusion.
/// </summary>
public class IncompleteHouseholdRecoveryTests
{
    private static Profile Member(string? suburb, string type = "residential", string? email = "member@example.test", DateTime? lastNudged = null) =>
        new()
        {
            Name = "Test Member",
            Email = email,
            Phone = email,
            LastNudgedAt = lastNudged,
            Household = new Household { Suburb = suburb, Type = type },
        };

    [Fact]
    public void A_member_with_no_suburb_is_exactly_who_this_is_for()
    {
        Assert.True(IncompleteHouseholdRecovery.NeedsRecovery(Member(null)));
        Assert.True(IncompleteHouseholdRecovery.NeedsRecovery(Member("")));
        Assert.True(IncompleteHouseholdRecovery.NeedsRecovery(Member("   ")));
    }

    [Fact]
    public void A_member_whose_suburb_is_city_wide_is_stuck_in_the_same_way()
    {
        // The silent variant. "BRISBANE" is non-empty, so a blank check would
        // decide this member is fine — and they would stay unreachable, which
        // is the exact failure being repaired.
        Assert.True(IncompleteHouseholdRecovery.NeedsRecovery(Member("BRISBANE")));
        Assert.True(IncompleteHouseholdRecovery.NeedsRecovery(Member("Brisbane")));
        Assert.True(IncompleteHouseholdRecovery.NeedsRecovery(Member("QLD")));
    }

    [Fact]
    public void A_member_with_a_real_suburb_is_never_contacted()
    {
        // They already get the progress nudge. Sending this as well would tell
        // someone who is fine that something is wrong with their account.
        Assert.False(IncompleteHouseholdRecovery.NeedsRecovery(Member("MOOROOKA")));
        Assert.False(IncompleteHouseholdRecovery.NeedsRecovery(Member("Yeronga")));
    }

    [Fact]
    public void A_building_resident_is_never_told_to_add_a_suburb()
    {
        // A unit complex is not missing a street — it is on the phase-2 track,
        // and /api/households refuses its address outright. Telling them to
        // "add your suburb" sends them to a form that will reject them.
        Assert.False(IncompleteHouseholdRecovery.NeedsRecovery(Member(null, type: "unit_complex")));
        Assert.False(IncompleteHouseholdRecovery.NeedsRecovery(Member("BRISBANE", type: "unit_complex")));
    }

    [Fact]
    public void A_member_with_no_household_or_no_email_is_not_contacted()
    {
        Assert.False(IncompleteHouseholdRecovery.NeedsRecovery(Member(null, email: null)));
        Assert.False(IncompleteHouseholdRecovery.NeedsRecovery(Member(null, email: "  ")));

        var noHousehold = new Profile { Name = "No House", Email = "x@example.test", Phone = "x@example.test" };
        Assert.False(IncompleteHouseholdRecovery.NeedsRecovery(noHousehold));
    }

    [Fact]
    public void Nobody_is_contacted_twice_inside_the_cooldown()
    {
        var now = new DateTime(2026, 8, 31, 12, 0, 0, DateTimeKind.Utc);

        Assert.True(IncompleteHouseholdRecovery.MayContact(Member(null), now));
        Assert.False(IncompleteHouseholdRecovery.MayContact(Member(null, lastNudged: now.AddDays(-1)), now));
        Assert.False(IncompleteHouseholdRecovery.MayContact(Member(null, lastNudged: now.AddDays(-6)), now));
        Assert.True(IncompleteHouseholdRecovery.MayContact(Member(null, lastNudged: now.AddDays(-8)), now));
    }

    [Fact]
    public void The_cooldown_is_far_longer_than_the_progress_nudge()
    {
        // One reminder that a suburb is missing is help. A daily one is nagging
        // somebody about a problem we caused.
        Assert.True(IncompleteHouseholdRecovery.Cooldown > WaitlistNudge.NudgeCooldown);
        Assert.Equal(TimeSpan.FromDays(7), IncompleteHouseholdRecovery.Cooldown);
    }

    [Fact]
    public void Recipients_filters_a_mixed_list_down_to_only_the_stuck()
    {
        var now = new DateTime(2026, 8, 31, 12, 0, 0, DateTimeKind.Utc);
        var members = new[]
        {
            Member(null),                                   // stuck
            Member("BRISBANE"),                             // stuck, silently
            Member("MOOROOKA"),                             // fine
            Member(null, type: "unit_complex"),             // different track
            Member(null, email: null),                      // unreachable
            Member(null, lastNudged: now.AddHours(-2)),     // too soon
        };

        Assert.Equal(2, IncompleteHouseholdRecovery.Recipients(members, now).Count);
    }

    [Fact]
    public void Sending_is_off_unless_ops_explicitly_turns_it_on()
    {
        // The code being ready is not a decision to email real members.
        Assert.False(IncompleteHouseholdRecovery.Enabled(null));
        Assert.False(IncompleteHouseholdRecovery.Enabled(""));
        Assert.False(IncompleteHouseholdRecovery.Enabled("false"));
        Assert.False(IncompleteHouseholdRecovery.Enabled("1"));
        Assert.False(IncompleteHouseholdRecovery.Enabled("yes"));

        Assert.True(IncompleteHouseholdRecovery.Enabled("true"));
        Assert.True(IncompleteHouseholdRecovery.Enabled("  TRUE  "));
    }
}
