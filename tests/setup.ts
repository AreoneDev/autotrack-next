import "@testing-library/jest-dom";

// jsdom lacks dialog methods; browser tests verify native focus behavior.
if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
}
