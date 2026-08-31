using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// One rule for how a member's name appears to someone who is not signed in.
///
/// The invite card had it, with a helper and tests. The runner leaderboard —
/// equally anonymous, no account needed — returned full names straight from
/// Profile.Name. Two anonymous surfaces carrying a member's name, one applying
/// the rule and one not, which is the same shape as every other drift this
/// week: the correct thing existed and a second caller did not reach for it.
///
/// The fallback is caller-supplied because "A neighbour" reads oddly on a
/// leaderboard, and a label that sounds wrong is an invitation to skip the
/// helper rather than use it.
/// </summary>
public class PublicNameExposureTests
{
    [Fact]
    public void Only_the_first_name_is_ever_exposed()
    {
        Assert.Equal("Sarah", InvitePreview.PublicFirstName("Sarah Chen"));
        Assert.Equal("Sarah", InvitePreview.PublicFirstName("Sarah Jane Chen-Williams"));
        Assert.Equal("Sarah", InvitePreview.PublicFirstName("  Sarah   Chen  "));
    }

    [Fact]
    public void An_email_address_never_leaks_through_the_name_field()
    {
        // Profile.Name is whatever the member typed, and the signup flow uses an
        // email as the phone/identity, so an email landing here is realistic.
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName("sarah.chen@example.com"));
        Assert.Equal("A runner", InvitePreview.PublicFirstName("sarah@example.com", "A runner"));
    }

    [Fact]
    public void Placeholders_and_implausible_lengths_fall_back()
    {
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName(null));
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName(""));
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName("You"));
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName("New"));
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName("X"));
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName(new string('A', 25)));
    }

    [Fact]
    public void The_caller_chooses_the_fallback_wording()
    {
        Assert.Equal("A runner", InvitePreview.PublicFirstName("", "A runner"));
        Assert.Equal("A runner", InvitePreview.PublicFirstName("You", "A runner"));
        // ...and the default is unchanged, so the invite card behaves as before.
        Assert.Equal("A neighbour", InvitePreview.PublicFirstName(""));
    }

    [Fact]
    public void A_surname_cannot_survive_the_helper()
    {
        // The property that matters, stated directly: whatever goes in, no
        // second word comes out.
        foreach (var name in new[] { "Sarah Chen", "Mary-Jane Watson", "Jean Luc Picard", "O'Brien Smith" })
        {
            var exposed = InvitePreview.PublicFirstName(name);
            Assert.DoesNotContain(" ", exposed);
        }
    }
}
