namespace GoodSort.Api.Data.Entities;

/// <summary>
/// One scan token that has already been redeemed. Its whole job is to make a
/// token single-use.
///
/// /confirm credits a member from a signed token rather than from the request
/// body, which stops the client inventing containers — but a signature says
/// "this token is genuine", never "this token has not been spent". The only
/// thing standing between a member and confirming the same token in a loop was
/// the perceptual-hash replay check, and that check is explicitly fail-open:
/// PerceptualHash.TryCompute returns null when ImageSharp cannot decode the
/// image, and ImageSharp does not decode HEIC — the iPhone default. A photo
/// picked from an iPhone library can therefore arrive with no hash at all, and
/// the anti-farm defence silently switches itself off for that scan.
///
/// The Jti is the primary key on purpose. A check-then-insert has a window two
/// concurrent confirms can both pass; a primary key does not.
/// </summary>
public class UsedScanToken
{
    /// <summary>The token's unique id, committed inside the signed payload.</summary>
    public Guid Jti { get; set; }

    public Guid UserId { get; set; }

    public DateTime UsedAt { get; set; } = DateTime.UtcNow;
}
