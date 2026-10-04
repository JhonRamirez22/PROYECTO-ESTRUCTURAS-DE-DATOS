import type { ReactNode } from "react";
import BackendAccessGuard from "@/components/BackendAccessGuard";

export default function CourierLayout({ children }: { children: ReactNode }) {
  return <BackendAccessGuard>{children}</BackendAccessGuard>;
}
