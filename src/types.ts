export interface Landmark {
  x: number; // 0..1, left to right in image
  y: number; // 0..1, top to bottom
  z: number; // depth, roughly same scale as x
}

export type Landmarks = Landmark[];

export interface Experiment {
  name: string;
  setup(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  update(landmarks: Landmarks | null, dt: number): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}
