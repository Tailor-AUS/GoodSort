using SkiaSharp;

namespace GoodSort.Api.Services;

/// <summary>
/// Perceptual image hashing (dHash) for deposit-photo replay detection using MIT-licensed SkiaSharp.
/// </summary>
public static class PerceptualHash
{
    public const int MaxEncodedLength = 14_000_000; // ~10.5 MB decoded ceiling
    public const int MaxDimensionPx = 8192;
    public const long MaxTotalPixels = 25_000_000;

    public static ulong? TryCompute(string base64Image)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(base64Image) || base64Image.Length > MaxEncodedLength)
                return null;

            var raw = base64Image.Contains(',') ? base64Image.Split(',')[1] : base64Image;
            var bytes = Convert.FromBase64String(raw);
            using var stream = new SKMemoryStream(bytes);
            using var codec = SKCodec.Create(stream);
            if (codec is null)
                return null;

            var info = codec.Info;
            if (info.Width <= 0
                || info.Height <= 0
                || info.Width > MaxDimensionPx
                || info.Height > MaxDimensionPx
                || (long)info.Width * info.Height > MaxTotalPixels)
            {
                return null;
            }

            using var decoded = SKBitmap.Decode(codec);
            if (decoded is null)
                return null;

            var targetInfo = new SKImageInfo(9, 8, SKColorType.Rgba8888, SKAlphaType.Premul);
            using var resized = decoded.Resize(targetInfo, new SKSamplingOptions(SKFilterMode.Linear));
            if (resized is null)
                return null;

            static int Luma(SKColor c) => (77 * c.Red + 150 * c.Green + 29 * c.Blue) >> 8;

            ulong hash = 0;
            var bit = 0;
            for (var y = 0; y < 8; y++)
            {
                for (var x = 0; x < 8; x++)
                {
                    var left = Luma(resized.GetPixel(x, y));
                    var right = Luma(resized.GetPixel(x + 1, y));
                    if (left > right) hash |= 1UL << bit;
                    bit++;
                }
            }
            return hash;
        }
        catch
        {
            return null;
        }
    }

    public static int HammingDistance(ulong a, ulong b) =>
        System.Numerics.BitOperations.PopCount(a ^ b);

    public static string ToHex(ulong hash) => hash.ToString("x16");

    public static bool TryFromHex(string? hex, out ulong hash)
    {
        hash = 0;
        return !string.IsNullOrEmpty(hex)
            && ulong.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out hash);
    }
}
