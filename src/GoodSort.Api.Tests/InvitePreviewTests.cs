using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

public class InvitePreviewTests
{
    [Theory]
    [InlineData("Sarah Jones", "Sarah")]
    [InlineData("moorooka-runner", "moorooka-runner")]
    [InlineData("New User", "A neighbour")]
    [InlineData("You", "A neighbour")]
    [InlineData("a@b.com", "A neighbour")]
    [InlineData("", "A neighbour")]
    [InlineData(null, "A neighbour")]
    public void Public_first_name_never_leaks_email_or_default(string? name, string expected)
        => Assert.Equal(expected, InvitePreview.PublicFirstName(name));
}
