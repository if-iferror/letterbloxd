// Firefox asks for data permissions from a click in an extension page.
const api = globalThis.browser || globalThis.chrome;
const answer = (granted) => api.runtime.sendMessage({ type: "consent", granted }).finally(() => window.close());
document.getElementById("allow").addEventListener("click", () => {
  api.permissions
    .request({ data_collection: ["personalCommunications", "technicalAndInteraction"] })
    .then(answer, () => answer(false));
});
document.getElementById("deny").addEventListener("click", () => answer(false));
