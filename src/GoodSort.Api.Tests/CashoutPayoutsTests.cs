using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class CashoutPayoutsTests
{
    [Fact]
    public void Placeholder_trace_account_never_opens_payouts()
    {
        Assert.False(CashoutService.PayoutsAreOpen(null, null, null, null));
        Assert.False(CashoutService.PayoutsAreOpen("true", "062-000", "12345678", "301500"));
        Assert.False(CashoutService.PayoutsAreOpen("true", "034-002", "12345678", "301500"));
        Assert.False(CashoutService.PayoutsAreOpen("false", "034-002", "98765432", "301500"));
    }

    [Fact]
    public void Real_remitter_config_opens_payouts()
    {
        Assert.True(CashoutService.PayoutsAreOpen("true", "034-002", "98765432", "301500"));
    }
}
