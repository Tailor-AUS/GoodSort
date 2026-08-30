using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class OpsAlertTests
{
    [Fact]
    public void Prefers_ops_alert_over_seed_admin()
        => Assert.Equal("ops@tailor.au", OpsAlert.Inbox("ops@tailor.au", "knox@tailor.au"));

    [Fact]
    public void Falls_back_to_seed_admin()
        => Assert.Equal("knox@tailor.au", OpsAlert.Inbox(null, " knox@tailor.au "));

    [Fact]
    public void Blank_or_non_email_is_no_inbox()
    {
        Assert.Null(OpsAlert.Inbox(null, null));
        Assert.Null(OpsAlert.Inbox("not-an-email", ""));
        Assert.Null(OpsAlert.Inbox("  ", "ops-only"));
    }

    [Fact]
    public void Purchase_needs_suburb_volume_threshold()
    {
        Assert.False(WaitlistDensity.CanPurchase(999));
        Assert.True(WaitlistDensity.CanPurchase(1000));
        Assert.True(WaitlistDensity.CanPurchase(1400));
    }
}
