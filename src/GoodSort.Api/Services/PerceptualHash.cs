using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace GoodSort.Api.Services;

/// <summary>
/// Perceptual image hashing (dHash) for deposit-photo replay detection.
///
/// A *cryptographic* hash is useless here — re-saving a JPEG changes every bit,
/// so a replayed photo would look "new". A perceptual hash fingerprints what the
/// image LOOKS like: two photos of the same scene produce near-identical hashes
/// even after recompression/resize, and we compare them by Hamming distance.
///
/// dHash algorithm: downscale to 9×8 greyscale, then for each row compare each
/// pixel to its right neighbour — 8×8 = 64 comparisons = a 64-bit fingerprint.
/// Robust to scale/compression/brightness, cheap to compute, no ML.
///
/// This raises the cost of farming: re-submitting the same image is rejected,
/// and re-using the same can forces a genuinely different camera angle each time.
/// It is one layer — velocity caps and the depot recount cover the rest.
/// </summary>
public static class PerceptualHash
{
    /// <summary>
    /// Compute the 64-bit dHash of a base64-encoded image (data-URI prefix
    /// tolerated). Returns null if the bytes can't be decoded as an image, so
    /// callers can fail open rather than block a deposit on a decode hiccup.
    /// </summary>
    public static ulong? TryCompute(string base64Image)
    {
        try
        {
            var raw = base64Image.Contains(',') ? base64Image.Split(',')[1] : base64Image;
            var bytes = Convert.FromBase64String(raw);
            using var image = Image.Load<L8>(bytes); // decode straight to 8-bit greyscale

            // 9 wide × 8 tall → 8 horizontal comparisons per row.
            image.Mutate(x => x.Resize(9, 8, KnownResamplers.Triangle));

            ulong hash = 0;
            var bit = 0;
            for (var y = 0; y < 8; y++)
            {
                for (var x = 0; x < 8; x++)
                {
                    // Bit is 1 when a pixel is brighter than its right neighbour.
                    var left = image[x, y].PackedValue;
                    var right = image[x + 1, y].PackedValue;
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

    /// <summary>
    /// Hamming distance between two dHashes — the number of differing bits
    /// (0 = identical, 64 = opposite). Small distance ⇒ visually the same image.
    /// </summary>
    public static int HammingDistance(ulong a, ulong b) =>
        System.Numerics.BitOperations.PopCount(a ^ b);

    /// <summary>Store hashes as a fixed 16-char hex string for easy DB indexing.</summary>
    public static string ToHex(ulong hash) => hash.ToString("x16");

    public static bool TryFromHex(string? hex, out ulong hash)
    {
        hash = 0;
        return !string.IsNullOrEmpty(hex)
            && ulong.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out hash);
    }
}
