import { MarketingHome } from "@/app/components/marketing/marketing-home";
import { homeMetadata } from "@/app/seo";

export const metadata = homeMetadata;

export default function StartPage() {
  return <MarketingHome />;
}
