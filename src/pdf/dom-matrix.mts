/**
 * `DOMMatrix` mínimo para pdf.js en Node (T-6.2): el build `legacy` de pdf.js evalúa `new DOMMatrix()`
 * al cargarse y, sin el addon nativo `@napi-rs/canvas` (que no viaja en el ejecutable autónomo), el
 * módulo ni siquiera arranca. Para extraer texto no se rasteriza nada: basta una matriz afín 2D con
 * las operaciones que pdf.js invoca. Se instala solo si el entorno no la tiene, antes de cargar pdf.js,
 * tanto en el repositorio como en el binario (mismo comportamiento en los dos).
 */

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** Matriz afín 2D `[a b c d e f]` con la semántica de `DOMMatrix` (columna-mayor, `is2D` siempre). */
export class AffineMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: ArrayLike<number> | AffineMatrix) {
    if (init instanceof AffineMatrix) {
      this.set(init.a, init.b, init.c, init.d, init.e, init.f);
    } else if (init !== undefined && init.length === 6) {
      this.set(...(Array.from(init) as [number, number, number, number, number, number]));
    }
  }

  get is2D(): boolean {
    return true;
  }

  get isIdentity(): boolean {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  private set(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  /** `this = this × other`. */
  multiplySelf(other: AffineMatrix): this {
    return this.set(
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f,
    );
  }

  /** `this = other × this`. */
  preMultiplySelf(other: AffineMatrix): this {
    const product = new AffineMatrix(other).multiplySelf(this);
    return this.set(product.a, product.b, product.c, product.d, product.e, product.f);
  }

  multiply(other: AffineMatrix): AffineMatrix {
    return new AffineMatrix(this).multiplySelf(other);
  }

  translate(tx = 0, ty = 0): AffineMatrix {
    return this.multiply(new AffineMatrix([1, 0, 0, 1, tx, ty]));
  }

  scale(sx = 1, sy: number = sx): AffineMatrix {
    return this.multiply(new AffineMatrix([sx, 0, 0, sy, 0, 0]));
  }

  /** Inversa en el sitio; una matriz singular queda con `NaN`, como en el DOM. */
  invertSelf(): this {
    const determinant = this.a * this.d - this.b * this.c;
    if (determinant === 0) {
      return this.set(Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN);
    }
    return this.set(this.d / determinant, -this.b / determinant, -this.c / determinant, this.a / determinant, (this.c * this.f - this.d * this.e) / determinant, (this.b * this.e - this.a * this.f) / determinant);
  }

  inverse(): AffineMatrix {
    return new AffineMatrix(this).invertSelf();
  }

  transformPoint(point: Partial<Point2D> = {}): Point2D {
    const x = point.x ?? 0;
    const y = point.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
  }

  toFloat64Array(): Float64Array {
    return new Float64Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
  }
}

/** Instala `AffineMatrix` como `DOMMatrix` si el entorno no trae una; devuelve si lo hizo. */
export function installDomMatrixPolyfill(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): boolean {
  if (target['DOMMatrix'] !== undefined) {
    return false;
  }
  target['DOMMatrix'] = AffineMatrix;
  return true;
}
