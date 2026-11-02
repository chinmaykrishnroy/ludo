const suffixes = ["", "K", "M", "B", "T", "Q"];
export function formatCount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return { compact: "—", exact: "Unavailable" };
  const count = Math.trunc(value);
  let tier =
    count < 1000
      ? 0
      : Math.min(suffixes.length - 1, Math.floor(Math.log10(count) / 3));
  if (
    Number((count / 1000 ** tier).toPrecision(3)) >= 1000 &&
    tier < suffixes.length - 1
  )
    tier++;
  const compact =
    new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: tier ? 3 : 4,
    }).format(count / 1000 ** tier) + suffixes[tier];
  return {
    compact,
    exact: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
      count,
    ),
  };
}
