// Counter settings per input mode. Feature units differ: torso lengths for the body, and for the
// motion grid grey levels in units of the picture's own spread (see motionFeatures), so the
// "is anything moving?" gates differ too.
// minSwing: a rep must move the body by roughly a third of a torso length (summed over the points
// that move); small sways and fidgets stay below it.
export const POSE_OPTIONS = { minMotion: 0.05, minSwing: 0.4 };
export const MOTION_OPTIONS = { minMotion: 0.2, minSwing: 0.8 };
