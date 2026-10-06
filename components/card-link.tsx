"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode, MouseEvent } from "react";
import { morphToProduct } from "./view-transition";

/* The product card's link. A plain tap/click navigates with the card photo morphing into the
   product page hero (View Transitions — components/view-transition.ts). Everything else is the
   normal <Link>: new-tab/modifier clicks, browsers without the API, reduced motion.

   A drag on the card's photo gallery or a tap on its arrows never reaches this handler: those
   swallow their click (preventDefault + stopPropagation) before it bubbles up to the <a>. */
export default function CardLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const photo = e.currentTarget.querySelector<HTMLElement>("[data-vt-slug]");
    if (morphToProduct(router, href, photo)) e.preventDefault();
  };
  return <Link className={className} href={href} onClick={onClick}>{children}</Link>;
}
