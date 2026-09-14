using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GoodSort.Api.Tests.Simulations.Harness;

public static class TestImageHelper
{
    /// <summary>
    /// Creates a valid base64-encoded JPEG image that SixLabors.ImageSharp can decode,
    /// ensuring PerceptualHash.TryCompute succeeds and produces a valid dHash.
    /// </summary>
    public static string CreateValidTestImageBase64(int width = 32, int height = 32)
    {
        using var image = new Image<Rgba32>(width, height);
        // Fill half image with white and half with black so dHash produces a non-zero hash
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                image[x, y] = x < width / 2 ? new Rgba32(255, 255, 255) : new Rgba32(0, 0, 0);
            }
        }

        using var ms = new MemoryStream();
        image.SaveAsJpeg(ms);
        return Convert.ToBase64String(ms.ToArray());
    }
}
