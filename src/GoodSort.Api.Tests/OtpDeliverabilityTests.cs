using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// The OTP is the only door into the product. The sending domain is not warmed,
/// so codes land in spam — these lock in the mitigations rather than letting
/// them drift back.
/// </summary>
public class OtpDeliverabilityTests
{
    [Fact]
    public void Codes_stay_valid_long_enough_to_find_in_spam()
    {
        // Five minutes is not enough time to check a spam folder on a phone.
        Assert.True(AuthService.OtpValidMinutes >= 15,
            "OTP window must survive a spam-folder hunt");
    }

    [Fact]
    public void The_window_is_still_bounded()
    {
        Assert.True(AuthService.OtpValidMinutes <= 30,
            "an auth credential must not be long-lived");
    }
}
