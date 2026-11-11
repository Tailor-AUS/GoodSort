using System.Buffers.Binary;
using GoodSort.Api.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GoodSort.Api.Tests;

public class PerceptualHashBoundsTests
{
    [Fact]
    public void Normal_image_computes_deterministic_64_bit_dhash()
    {
        using var img = new Image<L8>(16, 16);
        for (var y = 0; y < 16; y++)
        for (var x = 0; x < 16; x++)
            img[x, y] = new L8((byte)(x * 15));

        using var ms = new MemoryStream();
        img.SaveAsPng(ms);
        var b64 = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());

        var h1 = PerceptualHash.TryCompute(b64);
        var h2 = PerceptualHash.TryCompute(b64);

        Assert.NotNull(h1);
        Assert.Equal(h1, h2);
        Assert.Equal(0, PerceptualHash.HammingDistance(h1!.Value, h2!.Value));
    }

    [Fact]
    public void Synthetic_png_dimension_bomb_is_rejected_via_header_identify_before_pixel_allocation()
    {
        // Craft a minimal PNG signature + IHDR chunk claiming 50,000 x 50,000 pixels (2.5 billion pixels).
        // Image.Identify inspects IHDR without allocating the 2.5 GB pixel buffer.
        using var ms = new MemoryStream();
        ms.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG signature

        Span<byte> lenBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(lenBytes, 13);
        ms.Write(lenBytes);

        Span<byte> ihdr = stackalloc byte[4 + 13];
        "IHDR"u8.CopyTo(ihdr);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.Slice(4, 4), 50_000);  // width
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.Slice(8, 4), 50_000);  // height
        ihdr[12] = 8; // bit depth
        ihdr[13] = 0; // greyscale
        ihdr[14] = 0; // compression
        ihdr[15] = 0; // filter
        ihdr[16] = 0; // interlace
        ms.Write(ihdr);

        // CRC32 over "IHDR" + 13 data bytes
        var crc = ComputeCrc32(ihdr);
        Span<byte> crcBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, crc);
        ms.Write(crcBytes);

        var b64 = Convert.ToBase64String(ms.ToArray());
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var hash = PerceptualHash.TryCompute(b64);
        sw.Stop();

        Assert.Null(hash);
        Assert.True(sw.ElapsedMilliseconds < 500, $"Expected fast header rejection, took {sw.ElapsedMilliseconds}ms");
    }

    private static uint ComputeCrc32(ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFF_FFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var i = 0; i < 8; i++)
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }
}
