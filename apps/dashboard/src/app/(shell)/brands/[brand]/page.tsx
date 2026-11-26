import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FtrView } from "@/components/brands/FtrView";
import { SnapAppView } from "@/components/brands/SnapAppView";
import { YourTalView } from "@/components/brands/YourTalView";
import { PageHeader, Segmented } from "@/components/ui";
import { PAGES } from "@/lib/pages";
import { parsePeriod, periodOptions } from "@/lib/period";
import { requirePage } from "@/server/access";
import { getDashboardData } from "@/server/data";
import { isBrandId } from "@/server/types";
import { getViewer } from "@/server/viewer";

type Props = {
  params: Promise<{ brand: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { brand } = await params;
  return { title: isBrandId(brand) ? PAGES[brand].title : "Brand" };
}

const DOT = { yourtal: "yt", snapapp: "sa", ftr: "ftr" } as const;

/** /brands/yourtal, /brands/snapapp and /brands/ftr. A brand lead may open only their own. */
export default async function BrandPage({ params, searchParams }: Props) {
  const { brand } = await params;
  if (!isBrandId(brand)) notFound();
  const viewer = requirePage(await getViewer(), brand);
  const period = parsePeriod((await searchParams).period);
  const data = getDashboardData(viewer);
  const page = PAGES[brand];

  return (
    <div className="page-body">
      <PageHeader
        title={page.title}
        sub={page.sub}
        brand={DOT[brand]}
        actions={
          brand === "ftr" ? null : (
            <Segmented label="Period" value={period} options={periodOptions(page.path)} />
          )
        }
      />
      {brand === "yourtal" ? <YourTalView d={await data.brand("yourtal", { period })} /> : null}
      {brand === "snapapp" ? <SnapAppView d={await data.brand("snapapp", { period })} /> : null}
      {brand === "ftr" ? <FtrView d={await data.brand("ftr", { period })} /> : null}
    </div>
  );
}
