import type { ReactNode } from "react";
import { noIndexMetadata } from "@/app/seo";

export const metadata = noIndexMetadata;

export default function ScanLayout({ children }: { children: ReactNode }) {
  return children;
}
