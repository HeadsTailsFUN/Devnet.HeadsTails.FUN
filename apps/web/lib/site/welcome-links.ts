export type WelcomeSearch = Record<string, string | string[] | undefined>;

/** Relative, same-origin destinations only. Keep attribution and wallet return state. */
export function welcomeAppHref(search: WelcomeSearch = {}, earn = false): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  if (earn) query.set("earn", "1");
  return `/${query.size ? `?${query.toString()}` : ""}`;
}
