export interface Landmark {
  x: number; // 0..1, left to right in image
  y: number; // 0..1, top to bottom
  z: number; // depth, roughly same scale as x
}

export type Landmarks = Landmark[];

export type Blendshapes = Map<string, number>;

export interface FaceData {
  landmarks: Landmarks;
  blendshapes: Blendshapes;
  headPitch: number; // radians (rotX), positive = looking down
  headYaw: number; // radians (rotY), positive = turned left
  rawTransformMatrix?: number[]; // 4x4 column-major facial transformation matrix
}

export interface Experiment {
  name: string;
  setup(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  update(face: FaceData | null, dt: number): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, debug?: boolean): void;
  /** Receive body pose landmarks (33 points per person). Only called if implemented — no overhead otherwise.
   *  worldPoses: 3D metric coordinates (meters, hip-centered) for position-independent analysis. */
  updatePose?(poses: Landmarks[], dt: number, worldPoses?: Landmarks[]): void;
  /** Set up a representative scene for screenshots — no camera needed. */
  demo?(): void;
  /** Called when leaving the experiment (e.g. back to menu). Stop audio, timers, etc. */
  cleanup(): void;
  /** Extra buttons to add to the touch bar while this experiment is active. */
  extraButtons?: Array<{ label: string; key: string; onClick: () => void }>;
}
