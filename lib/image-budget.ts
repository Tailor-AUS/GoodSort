/**
 * Making a phone photo small enough for the vision endpoint to accept.
 *
 * The camera path already re-encodes through a canvas at JPEG 0.8, so it lands
 * around 150-400 KB and is never a problem. The gallery path did not: it read
 * the file straight through FileReader and posted the raw bytes, accepting
 * anything up to 10 MB client-side while the API rejects a base64 body over
 * 2,000,000 characters — roughly 1.5 MB of image.
 *
 * A photo off any recent phone is 2-5 MB. So the window where the gallery path
 * worked was 0-1.5 MB, which in practice is a screenshot or nothing. Every real
 * photo came back 413, and the member was told "Could not reach the server.
 * Check your connection and try again" — wrong advice for a request that will
 * fail identically forever.
 *
 * That path is not an edge case. It is what the app itself tells you to use:
 * "Camera blocked - tap the green button to use your photo gallery", and on a
 * denied camera the gallery button becomes the big green primary action.
 *
 * The sizing lives here, away from canvas and Image, so it can be tested.
 */

/** The API rejects a base64 body longer than this. Program.cs owns the number. */
export const MAX_BASE64_CHARS = 2_000_000;

/**
 * Aim below the ceiling rather than at it. Base64 length varies with the exact
 * bytes, and a photo that lands at 1,999,000 on one phone lands over on another.
 */
export const TARGET_BASE64_CHARS = 1_400_000;

/** Longest edge to allow. Well beyond what container identification needs. */
export const MAX_EDGE_PX = 1600;

/** JPEG qualities to try, in order, before giving up. */
export const QUALITY_LADDER = [0.8, 0.6, 0.45] as const;

/**
 * Scale a photo's dimensions so its longest edge fits, preserving aspect ratio.
 * Never scales up — a small photo is left alone.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE_PX,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };

  const scale = maxEdge / longest;
  return {
    // At least 1px: a panorama scaled hard could otherwise round an edge to 0
    // and produce a canvas that throws.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Base64 length for a given number of bytes, including padding. */
export function base64Length(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / 3) * 4;
}

/** Would a body of this base64 length be refused by the API? */
export function exceedsApiLimit(base64Chars: number): boolean {
  return base64Chars > MAX_BASE64_CHARS;
}

/**
 * What to tell a member whose photo the server refused, given the status.
 * A 413 is not a connection problem and must not be described as one — the
 * advice "check your connection and try again" produces an identical failure
 * every time.
 */
export function scanErrorMessage(status: number | null): string {
  if (status === 413) {
    return "That photo is too large to send. Try taking a new one with the camera, which uses a smaller file.";
  }
  if (status === 401 || status === 403) {
    return "Your session expired. Sign in again and re-take the photo.";
  }
  if (status === 429) {
    return "That is a lot of scanning in one go. Wait a minute and try again.";
  }
  if (status !== null && status >= 500) {
    return "Something went wrong on our side. Try again in a moment.";
  }
  return "Could not reach the server. Check your connection and try again.";
}
