import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectMarkerAt, expectPose, geometry, idleWindow, installRenderCounters, openPlayground, renderStats } from './support';

/** Canvas backing size versus CSS size of the visible canvas. */
async function canvasSize(ball: Locator): Promise<{ width: number; height: number; cssWidth: number; cssHeight: number }> {
  return ball.locator('canvas:visible').evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight,
  }));
}

async function expectBacking(ball: Locator, ratio: number): Promise<void> {
  await expect.poll(async () => {
    const s = await canvasSize(ball);
    return s.width === Math.floor(s.cssWidth * ratio) && s.height === Math.floor(s.cssHeight * ratio)
      ? 'ok' : JSON.stringify(s);
  }, { message: `backing store = CSS size x ${ratio}` }).toBe('ok');
}

test.describe('rendering', () => {
  test('no rendering while idle; one frame per change', async ({ page }) => {
    await page.addInitScript(installRenderCounters);
    const ball = await openPlayground(page);
    await page.evaluate(() => document.fonts.ready);
    expect((await renderStats(page)).draws, 'initial frame drawn').toBeGreaterThan(0);
    expect(await idleWindow(page)).toEqual({ raf: 0, draws: 0, clears: 0 });

    const g = await geometry(ball);
    await page.mouse.move(g.cx - 40, g.cy); // hover without pressing: no frames
    await page.mouse.move(g.cx + 40, g.cy + 30, { steps: 5 });
    expect(await idleWindow(page)).toEqual({ raf: 0, draws: 0, clears: 0 });

    const beforeKey = await renderStats(page);
    await ball.focus();
    await page.keyboard.press('ArrowRight');
    await expectPose(page, { x: 0.02 });
    await expect.poll(async () => (await renderStats(page)).draws).toBeGreaterThan(beforeKey.draws);
    expect((await renderStats(page)).raf - beforeKey.raf).toBeGreaterThanOrEqual(1);
    expect(await idleWindow(page)).toEqual({ raf: 0, draws: 0, clears: 0 });
  });

  test.describe('device pixel ratio 2', () => {
    test.use({ deviceScaleFactor: 2 });
    test('backing store = CSS size x 2 and follows layout resizes', async ({ page }) => {
      const ball = await openPlayground(page);
      await expectBacking(ball, 2);
      const before = await canvasSize(ball);
      await page.setViewportSize({ width: 420, height: 800 });
      await expect.poll(async () => (await canvasSize(ball)).cssWidth).toBeLessThan(before.cssWidth);
      await expectBacking(ball, 2);
    });
  });

  test('devicePixelRatio changes are picked up without a layout change', async ({ page }) => {
    const ball = await openPlayground(page);
    await expectBacking(ball, 1);
    const cssWidth = (await canvasSize(ball)).cssWidth;
    const viewport = page.viewportSize()!;
    const cdp = await page.context().newCDPSession(page);
    // Chromium's emulation only re-evaluates media-query listeners together with a
    // viewport change, so nudge the viewport by 1 px. The trackball's own size is
    // unchanged (its column is capped at 510 px), so ResizeObserver cannot fire:
    // only the resolution media query can trigger the re-render.
    let nudge = 0;
    const setRatio = async (deviceScaleFactor: number): Promise<void> => {
      nudge = 1 - nudge;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width + nudge, height: viewport.height, deviceScaleFactor, mobile: false,
      });
    };
    await setRatio(2);
    await expectBacking(ball, 2);
    await setRatio(1.5); // the resolution query is re-armed after every change
    await expectBacking(ball, 1.5);
    await setRatio(3);
    await expectBacking(ball, 2); // capped
    await setRatio(1);
    await expectBacking(ball, 1);
    expect((await canvasSize(ball)).cssWidth).toBe(cssWidth);
  });

  test('WebGL context loss falls back to 2D and recovers on restore', async ({ page }) => {
    const ball = await openPlayground(page);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.lq-trackball canvas')!;
      const gl = canvas.getContext('webgl2')!;
      (window as unknown as { loseContext: WEBGL_lose_context }).loseContext = gl.getExtension('WEBGL_lose_context')!;
      (window as unknown as { loseContext: WEBGL_lose_context }).loseContext.loseContext();
    });
    await expect(ball).toHaveAttribute('data-renderer', '2d');
    await expect(ball.locator('canvas:visible')).toHaveCount(1);
    await ball.focus();
    await page.keyboard.press('ArrowDown'); // still operable while lost
    await expectPose(page, { y: 0.02 });
    await page.evaluate(() => (window as unknown as { loseContext: WEBGL_lose_context }).loseContext.restoreContext());
    await expect(ball).toHaveAttribute('data-renderer', 'webgl');
    await expect(ball.locator('canvas')).toHaveCount(1);
    await expectBacking(ball, 1);
    await page.keyboard.press('ArrowDown');
    await expectPose(page, { y: 0.04 });
    await expectMarkerAt(page, ball, { x: 0, y: 0.04, z: 0.5 }); // GPU resources re-created
  });
});
