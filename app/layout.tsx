import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#c0562b",
};

export const metadata: Metadata = {
  title: "Reverse Recipe — cook any meal from a photo",
  description:
    "Snap a photo of any meal and get the ingredients, calories, and a recipe to make it yourself.",
  openGraph: {
    title: "Reverse Recipe",
    description:
      "Snap a photo of any meal and get the ingredients, calories, and a recipe to make it yourself.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
