using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class AuthSeedAdminTests
{
    [Fact]
    public void Promotes_only_the_matching_seed_when_no_admin_exists()
    {
        Assert.True(AuthService.ShouldPromoteSeedAdmin(false, false, "knox@tailor.au", "knox@tailor.au"));
        Assert.True(AuthService.ShouldPromoteSeedAdmin(false, false, "Knox@Tailor.au", "knox@tailor.au"));
        Assert.False(AuthService.ShouldPromoteSeedAdmin(false, false, "neighbour@example.com", "knox@tailor.au"));
        Assert.False(AuthService.ShouldPromoteSeedAdmin(true, false, "knox@tailor.au", "knox@tailor.au"));
        Assert.False(AuthService.ShouldPromoteSeedAdmin(false, true, "knox@tailor.au", "knox@tailor.au"));
        Assert.False(AuthService.ShouldPromoteSeedAdmin(false, false, "knox@tailor.au", ""));
        Assert.False(AuthService.ShouldPromoteSeedAdmin(false, false, "knox@tailor.au", null));
    }
}
