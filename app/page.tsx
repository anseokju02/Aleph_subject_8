"use client";

import { useEffect } from "react";
import { publicProfileHtml } from "@/lib/public-profile";

export default function Home() {
  useEffect(() => {
    const dialog = document.getElementById("strength-dialog") as HTMLDialogElement | null;
    const open = document.getElementById("open-strengths");
    const close = document.getElementById("close-strengths");
    if (!dialog || !open || !close) return;
    const show = () => dialog.showModal();
    const hide = () => dialog.close();
    const backdrop = (event: MouseEvent) => {
      if (event.target === dialog) dialog.close();
    };
    const restoreFocus = () => open.focus();
    open.addEventListener("click", show);
    close.addEventListener("click", hide);
    dialog.addEventListener("click", backdrop);
    dialog.addEventListener("close", restoreFocus);
    return () => {
      open.removeEventListener("click", show);
      close.removeEventListener("click", hide);
      dialog.removeEventListener("click", backdrop);
      dialog.removeEventListener("close", restoreFocus);
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: publicProfileHtml }} />;
}
