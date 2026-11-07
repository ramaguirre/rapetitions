// Counter settings per input mode. Feature units differ: torso lengths for the body, grey levels
// (0..1) for the motion grid, so the "is anything moving?" gate differs too.
// minSwing: a rep must move the body by roughly a third of a torso length (summed over the points
// that move); small sways and fidgets stay below it.
export const POSE_OPTIONS = { minMotion: 0.05, minSwing: 0.4 };
export const MOTION_OPTIONS = { minMotion: 0.03, minSwing: 0.15 };
