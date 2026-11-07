// Counter settings per input mode. Feature units differ: torso lengths for the body, and for the
// motion grid grey levels in units of the picture's own spread (see motionFeatures), so the
// "is anything moving?" gates differ too.
// minSwing: a rep must move the body by roughly a torso length (summed over the points that move).
// Synthetic fidgeting swings 0.7-1.1 and could pass as a slow rhythm; arm curls, the smallest real
// movement in the tests, swing about 1.6.
export const POSE_OPTIONS = { minMotion: 0.05, minSwing: 1.2 };
// Motion: a still scene's camera noise can line up into a 1.5 swing over a 3 s look-back; real
// movements in the synthetic views swing 8 or more.
export const MOTION_OPTIONS = { minMotion: 0.2, minSwing: 2.5 };
