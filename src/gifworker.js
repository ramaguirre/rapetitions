// Encodes a rep clip off the main thread, so the camera and the count never stall.
import { encodeGif } from "./gif.js";

self.onmessage = (e) => {
  const { id, frames, w, h } = e.data;
  try {
    const gif = encodeGif(frames, w, h);
    self.postMessage({ id, gif }, [gif.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
