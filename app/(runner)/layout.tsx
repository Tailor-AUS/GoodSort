import type { ReactNode } from "react";
import { noIndexMetadata } from "@/app/seo";

export const metadata = noIndexMetadata;

export default function RunnerLayout({ children }: { children: ReactNode }) {
  return children;
}
