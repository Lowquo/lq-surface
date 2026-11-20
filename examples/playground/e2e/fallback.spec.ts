import { expect, test } from '@playwright/test';
import { expectMarkerAt, expectPose, geometry, idleWindow, installRenderCounters, openPlayground } from './support';

// Real WebGL unavailability, not a mock: Chromium with WebGL and 3D APIs disabled.
test.use({ launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } });

test('without WebGL the 2D fallback shows the value and stays fully interactive', async ({ page }) => {
  await page.addInitScript(installRenderCounters);
  const ball = await openPlayground(page, '2d');
  await expect(ball.locator('canvas')).toHaveCount(1);
  await expectMarkerAt(page, ball, { x: 0, y: 0, z: 0.5 });

  await ball.focus();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('PageUp');
  await expectPose(page, { x: -0.2, y: 0, z: 0.51 });
  await expectMarkerAt(page, ball, { x: -0.2, y: 0, z: 0.51 });

  const g = await geometry(ball);
  await page.mouse.move(g.cx, g.cy);
  await page.mouse.down();
  await page.mouse.move(g.cx + 20, g.cy + 30, { steps: 3 });
  await page.mouse.up();
  await expectPose(page, { x: -0.2 + 20 / g.travel, y: 30 / g.travel });
  await page.mouse.wheel(0, -100);
  await expectPose(page, { z: 0.535 });
  await page.mouse.dblclick(g.cx, g.cy);
  await expectPose(page, { x: 0, y: 0, z: 0.5 });
  await expectMarkerAt(page, ball, { x: 0, y: 0, z: 0.5 });

  // On-demand rendering applies to the fallback too.
  expect(await idleWindow(page)).toEqual({ raf: 0, draws: 0, clears: 0 });
});
