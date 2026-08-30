using GoodSort.Api.Services;

namespace GoodSort.Api.Tests;

/// <summary>
/// The model writes the text at the top of the results screen — the highest
/// attention moment in the product. It must never author money copy: the
/// scheme refund is 10c, the product credit is 5c, and conflating them implies
/// we pass through the Containers for Change refund.
/// </summary>
public class VisionCopyGuardTests
{
    [Theory]
    [InlineData("3 Coke cans spotted! That's 30 cents heading your way")]
    [InlineData("you're definitely worth more than 10 cents!")]
    [InlineData("the stuff you get 10 cents for")]
    [InlineData("That's $1.50 in the bag")]
    [InlineData("Nice haul — a refund is coming")]
    [InlineData("worth a few dollars")]
    public void Model_money_claims_are_replaced(string modelText)
    {
        var result = new VisionResult { Message = modelText };
        Assert.DoesNotContain("cent", result.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("$", result.Message);
        Assert.Equal("Point the camera at cans or bottles to add them to your sort.", result.Message);
    }

    [Theory]
    [InlineData("Nice haul! 3 cans ready to sort.")]
    [InlineData("Spotted some VB stubbies — classic choice, even better recycled.")]
    [InlineData("I can't quite make that out — try getting closer with better lighting.")]
    public void Ordinary_encouragement_survives(string modelText)
    {
        Assert.Equal(modelText, new VisionResult { Message = modelText }.Message);
    }

    [Fact]
    public void Cans_is_not_mistaken_for_a_money_amount()
    {
        // A naive \d+\s*c rule would flag "3 cans".
        const string text = "3 cans and 2 bottles ready to sort.";
        Assert.Equal(text, new VisionResult { Message = text }.Message);
    }

    [Fact]
    public void Null_and_blank_messages_are_safe()
    {
        Assert.Equal("", new VisionResult { Message = null! }.Message);
        Assert.Equal("", new VisionResult().Message);
    }

    [Fact]
    public void Eligible_defaults_to_false_so_a_malformed_response_mints_nothing()
    {
        Assert.False(new IdentifiedContainer().Eligible);
    }
}
