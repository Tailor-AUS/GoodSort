using System.Reflection;
using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// On 2026-08-30 every signup failed with ACS `DomainNotLinked` and the product
/// reported "Failed to send email. Try again." — inviting users to retry a fault
/// that no amount of retrying could fix, while nothing alerted anyone. These
/// lock in the distinction between "transient" and "we are broken for everyone".
/// </summary>
public class OtpFailureClassificationTests
{
    static bool Classify(string errorCode)
    {
        var m = typeof(AuthService).GetMethod("IsSenderMisconfigured",
            BindingFlags.NonPublic | BindingFlags.Static)!;
        return (bool)m.Invoke(null, [new Azure.RequestFailedException(400, "x", errorCode, null)])!;
    }

    [Theory]
    [InlineData("DomainNotLinked")]        // the 2026-08-30 outage
    [InlineData("SenderNotFound")]
    [InlineData("SenderDomainNotVerified")]
    [InlineData("InvalidSenderAddress")]
    [InlineData("Unauthorized")]
    public void Configuration_faults_are_recognised(string code)
    {
        Assert.True(Classify(code), $"{code} breaks every signup and must not be treated as transient");
    }

    [Theory]
    [InlineData("TooManyRequests")]
    [InlineData("ServiceUnavailable")]
    [InlineData("InternalServerError")]
    [InlineData("RequestTimeout")]
    public void Transient_faults_are_not_misreported_as_configuration(string code)
    {
        Assert.False(Classify(code), $"{code} may succeed on retry");
    }

    [Fact]
    public void An_unknown_error_code_is_treated_as_transient()
    {
        // Fail open: a code we've never seen should not tell the user the
        // product is broken when it might just be a blip.
        Assert.False(Classify("SomethingNobodyHasSeenBefore"));
    }
}
