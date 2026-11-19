using SkiaSharp;

namespace GoodSort.Api.Tests.Simulations.Harness;

public static class TestImageHelper
{
    public static string CreateValidTestImageBase64(int width = 32, int height = 32)
    {
        using var bmp = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Opaque));
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                bmp.SetPixel(x, y, x < width / 2 ? SKColors.White : SKColors.Black);
            }
        }

        using var img = SKImage.FromBitmap(bmp);
        using var encoded = img.Encode(SKEncodedImageFormat.Jpeg, 90);
        return Convert.ToBase64String(encoded.ToArray());
    }

    public static string CreateDistinctTestImageBase64(int stripeColumn)
    {
        using var bmp = new SKBitmap(new SKImageInfo(32, 32, SKColorType.Rgba8888, SKAlphaType.Opaque));
        for (var y = 0; y < 32; y++)
        {
            for (var x = 0; x < 32; x++)
            {
                var isWhite = x >= stripeColumn * 6 && x < stripeColumn * 6 + 4;
                bmp.SetPixel(x, y, isWhite ? SKColors.White : SKColors.Black);
            }
        }

        using var img = SKImage.FromBitmap(bmp);
        using var encoded = img.Encode(SKEncodedImageFormat.Jpeg, 90);
        return Convert.ToBase64String(encoded.ToArray());
    }
}
