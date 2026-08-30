using GoodSort.Api.Data.Entities;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// Scan-first members earn credit before they have an address. Settle only ever
/// sees scans filtered by household, so an address-less scan is unsettleable
/// until it is attached — otherwise the credit is stranded forever, which is
/// the same defect that made the $1 referral permanently uncashable.
/// </summary>
public class ScanBackfillTests
{
    static Scan Pending(Guid user, string material = "aluminium", int cents = 5) =>
        new() { UserId = user, Material = material, RefundCents = cents, Status = "pending" };

    [Fact]
    public void Address_less_scans_attach_to_the_new_household()
    {
        var user = Guid.NewGuid();
        var hh = new Household { Suburb = "MOOROOKA" };
        var scans = new List<Scan> { Pending(user), Pending(user), Pending(user) };

        var moved = ScanBackfill.AttachTo(hh, scans);

        Assert.Equal(3, moved);
        Assert.All(scans, s => Assert.Equal(hh.Id, s.HouseholdId));
    }

    [Fact]
    public void The_containers_they_were_holding_now_count_toward_the_suburb()
    {
        var user = Guid.NewGuid();
        var hh = new Household { Suburb = "MOOROOKA", PendingContainers = 0 };
        ScanBackfill.AttachTo(hh, [Pending(user), Pending(user)]);

        Assert.Equal(2, hh.PendingContainers);

        // And that is what the public demand board sums.
        var board = WaitlistDensity.Aggregate([
            new HouseholdClusterRow("MOOROOKA", 5, "residential", hh.PendingContainers, BinStatuses.Waitlisted),
        ]);
        Assert.Equal(2, Assert.Single(board.Suburbs).Containers);
    }

    [Fact]
    public void Launch_bonus_credit_survives_the_move_and_can_then_settle()
    {
        var user = Guid.NewGuid();
        var hh = new Household();
        var bonusScan = Pending(user, cents: LaunchBonus.CentsPerContainer);
        ScanBackfill.AttachTo(hh, [bonusScan]);

        Assert.Equal(LaunchBonus.CentsPerContainer, hh.PendingValueCents);

        // Now settleable — and the bonus portion clears.
        var member = new Profile { Id = user, PendingCents = LaunchBonus.CentsPerContainer };
        var runnerCredit = HouseholdCredit.ApplyPickup([member], [bonusScan], pickupCount: 1);
        Assert.Equal("settled", bonusScan.Status);
        Assert.Equal(runnerCredit + LaunchBonus.ExtraCentsPerContainer, member.ClearedCents);
    }

    [Fact]
    public void Materials_are_folded_in()
    {
        var user = Guid.NewGuid();
        var hh = new Household();
        ScanBackfill.AttachTo(hh, [
            Pending(user, "aluminium"), Pending(user, "pet"),
            Pending(user, "glass"), Pending(user, "something-else"),
        ]);

        Assert.Equal(1, hh.Materials.Aluminium);
        Assert.Equal(1, hh.Materials.Pet);
        Assert.Equal(1, hh.Materials.Glass);
        Assert.Equal(1, hh.Materials.Other);
    }

    [Fact]
    public void Existing_household_totals_are_added_to_not_replaced()
    {
        var user = Guid.NewGuid();
        var hh = new Household { PendingContainers = 10, PendingValueCents = 50 };
        ScanBackfill.AttachTo(hh, [Pending(user), Pending(user)]);

        Assert.Equal(12, hh.PendingContainers);
        Assert.Equal(60, hh.PendingValueCents);
    }

    [Fact]
    public void Nothing_to_attach_is_a_no_op()
    {
        var hh = new Household { PendingContainers = 4, PendingValueCents = 20 };
        Assert.Equal(0, ScanBackfill.AttachTo(hh, []));
        Assert.Equal(4, hh.PendingContainers);
        Assert.Equal(20, hh.PendingValueCents);
    }
}
