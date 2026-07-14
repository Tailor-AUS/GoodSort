import type { ReactNode } from "react";
import { noIndexMetadata } from "@/app/seo";

export const metadata = noIndexMetadata;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
