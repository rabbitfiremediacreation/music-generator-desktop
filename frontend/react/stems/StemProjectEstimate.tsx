import { useQuery } from "@tanstack/react-query";
import { stemApi, type StemRequest } from "../../stems";
import { useI18n } from "../i18n";

export function StemProjectEstimate({ requests }: { requests: StemRequest[] }) {
  const { t, language } = useI18n();
  const estimate = useQuery({
    queryKey: ["stem-project-estimate", requests],
    async queryFn() {
      const results = await Promise.allSettled(requests.map(request => stemApi.preflight(request)));
      const checked = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      return { bytes: checked.reduce((total, project) => total + project.bytes, 0), count: checked.length };
    },
    enabled: requests.length > 0, networkMode: "always", retry: false, staleTime: 0, gcTime: 0,
  });
  if (!requests.length) return null;
  const size = estimate.data?.count
    ? `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(estimate.data.bytes / 1024 ** 2)} MiB`
    : "—";
  return <>
    <dt>{t("stem_approx_size")}</dt>
    <dd>{estimate.isPending ? <span role="status">{t("stem_preflighting")}</span> : size}
      {estimate.data && estimate.data.count < requests.length && ` · ${estimate.data.count}/${requests.length}`}</dd>
  </>;
}
