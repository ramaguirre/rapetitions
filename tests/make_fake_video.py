"""Writes a .y4m clip for Chrome's fake camera: a bright block moving down and up N times.

    python tests/make_fake_video.py out.y4m [reps] [period_s]

Layout: 3 s still, the reps, 6 s still. Grey levels only (Y plane), 320x240, 15 fps.
"""
import math
import sys

W, H, FPS = 320, 240, 15


def main(path, reps=10, period=2.0):
    frames = int((3 + reps * period + 6) * FPS)
    chroma = bytes([128]) * (W * H // 2)
    with open(path, "wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n".encode())
        for i in range(frames):
            t = i / FPS
            active = 3 <= t < 3 + reps * period
            ph = ((t - 3) / period) % 1 if active else 0
            top = int(30 + 110 * (1 - math.cos(2 * math.pi * ph)) / 2)
            y = bytearray([50]) * (W * H)
            for row in range(top, top + 70):
                y[row * W + 110: row * W + 210] = bytes([210]) * 100
            f.write(b"FRAME\n" + bytes(y) + chroma)


if __name__ == "__main__":
    main(sys.argv[1], *(int(sys.argv[2]),) if len(sys.argv) > 2 else (), *(float(sys.argv[3]),) if len(sys.argv) > 3 else ())
