import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "선물 선택 연구", description: "선물 선택 연구 참여 시스템" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
