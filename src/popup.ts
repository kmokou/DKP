import { stringifyUnknown } from "./core";

const openButton = document.getElementById("open") as HTMLButtonElement;
const error = document.getElementById("error") as HTMLParagraphElement;

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  openButton.textContent = "Opening DKP…";
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url))
      throw new Error(
        "Open a lesson or exercise first, then click the DKP icon.",
      );
    const response = await browser.runtime.sendMessage({
      type: "openWorkspace",
      sourceTabId: tab.id,
    });
    if (!response?.ok)
      throw response?.error || new Error("DKP could not open.");
    window.close();
  } catch (reason) {
    error.hidden = false;
    if (reason && typeof reason === "object" && "message" in reason) {
      const report = reason as { title?: unknown; message: unknown };
      const title = typeof report.title === "string" ? `${report.title}: ` : "";
      error.textContent = title + stringifyUnknown(report.message);
    } else
      error.textContent =
        reason instanceof Error
          ? reason.message
          : "DKP could not open.";
    openButton.disabled = false;
    openButton.innerHTML = "Open DKP workspace <span>↗</span>";
  }
});
