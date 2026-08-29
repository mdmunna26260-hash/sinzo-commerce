"use client";
import { useEffect } from "react";

/* Premium Shared Element + Fade Page Transition.
   Uses native View Transitions API (Chrome/Edge) with CSS fallback for Safari/Firefox.
   Zero JS animation library, zero artificial delay, GPU-accelerated. */
export default function PageTransition() {
  useEffect(() => {
    // Enable smooth scroll restoration
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }

    // Add transition styles dynamically for browsers that support View Transitions API
    const style = document.createElement("style");
    style.id = "page-transition-styles";
    style.textContent = `
      @view-transition {
        navigation: auto;
      }

      ::view-transition-old(root) {
        animation: vtFadeOut 200ms ease-out both;
      }

      ::view-transition-new(root) {
        animation: vtFadeIn 250ms ease-out both;
        animation-delay: 100ms;
      }

      ::view-transition-old(product-hero),
      ::view-transition-new(product-hero) {
        animation: none;
        mix-blend-mode: normal;
        height: 100%;
        overflow: clip;
        object-fit: cover;
      }

      ::view-transition-group(product-hero) {
        animation-duration: 300ms;
        animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
      }

      @keyframes vtFadeOut {
        to { opacity: 0; }
      }

      @keyframes vtFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);

  return null;
}
