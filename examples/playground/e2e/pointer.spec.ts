import { expect, test } from '@playwright/test';
import { expectMarkerAt, expectPose, geometry, openPlayground, readPose } from './support';

test.describe('pointer, wheel and sliders', () => {
  test('drag is relative and moves the marker 1:1 with the pointer', async ({ page }) => {
    const ball = await openPlayground(page);
    const g = await geometry(ball);
    await page.mouse.move(g.cx - 50, g.cy + 10);
    await page.mouse.down(); // pressing away from the marker does not jump
    await expectPose(page, { x: 0, y: 0 });
    await page.mouse.move(g.cx - 10, g.cy - 20, { steps: 5 }); // right 40, up 30
    await expectPose(page, { x: 40 / g.travel, y: -30 / g.travel, z: 0.5 });
    await page.mouse.move(g.cx - 10, g.cy + 10, { steps: 3 }); // down 30
    await expectPose(page, { x: 40 / g.travel, y: 0 });
    await page.mouse.up();
    await expectMarkerAt(page, ball, await readPose(page));
  });

  test('Shift drag is exactly 10x finer; Alt drag changes z (up increases)', async ({ page }) => {
    const ball = await openPlayground(page);
    const g = await geometry(ball);
    await page.mouse.move(g.cx, g.cy);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(g.cx + 50, g.cy + 20, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expectPose(page, { x: 5 / g.travel, y: 2 / g.travel, z: 0.5 });
    const before = await readPose(page);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(g.cx + 80, g.cy - 20, { steps: 5 }); // horizontal ignored, up 40
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expectPose(page, { x: before.x, y: before.y, z: 0.5 + (40 / g.travel) * 0.5 });
  });

  test('double-click resets to neutral', async ({ page }) => {
    const ball = await openPlayground(page);
    await ball.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('PageUp');
    await expectPose(page, { x: 0.02, z: 0.51 });
    const g = await geometry(ball);
    await page.mouse.dblclick(g.cx + 40, g.cy + 40);
    await expectPose(page, { x: 0, y: 0, z: 0.5 });
  });

  test('wheel changes z: 0.025 per 100 px notch, Shift 10x finer, page does not scroll', async ({ page }) => {
    const ball = await openPlayground(page);
    const g = await geometry(ball);
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.wheel(0, -100);
    await expectPose(page, { z: 0.525 });
    await page.mouse.wheel(0, 200);
    await expectPose(page, { z: 0.475 });
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Shift');
    await expectPose(page, { x: 0, y: 0, z: 0.4775 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('what you see is the value: the marker is drawn at the pose position', async ({ page }) => {
    const ball = await openPlayground(page);
    await expectMarkerAt(page, ball, { x: 0, y: 0, z: 0.5 });
    await ball.focus();
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 15; i += 1) await page.keyboard.press('ArrowUp');
    await expectPose(page, { x: 0.2, y: -0.3 });
    await expectMarkerAt(page, ball, { x: 0.2, y: -0.3, z: 0.5 });
    await page.keyboard.press('Home');
    for (let i = 0; i < 55; i += 1) await page.keyboard.press('ArrowDown'); // to the rim
    await expectPose(page, { x: 0, y: 1 });
    await expectMarkerAt(page, ball, { x: 0, y: 1, z: 0.5 });
    for (let i = 0; i < 30; i += 1) await page.keyboard.press('ArrowLeft'); // slides along the rim
    const rim = await readPose(page);
    expect(Math.hypot(rim.x, rim.y)).toBeCloseTo(1, 2);
    await expectMarkerAt(page, ball, rim);
  });

  test('sliders and trackball stay in sync both ways', async ({ page }) => {
    const ball = await openPlayground(page);
    await ball.focus();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
    await expect(page.locator('#x')).toHaveValue('0.06');
    await expect(page.locator('#x-value')).toHaveText('0.060');

    await page.locator('#y').focus();
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
    await expect(page.locator('#y-value')).toHaveText('0.020');
    await expect(ball).toHaveAccessibleDescription(/X 0\.060, Y 0\.020, Z 0\.500/);
    await expectMarkerAt(page, ball, { x: 0.06, y: 0.02, z: 0.5 });

    // Pointer drag on the z slider.
    await page.locator('#z').scrollIntoViewIfNeeded();
    const box = (await page.locator('#z').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    const z = Number(await page.locator('#z').inputValue());
    expect(z).toBeGreaterThan(0.7);
    await expect(ball).toHaveAccessibleDescription(new RegExp(`Z ${z.toFixed(3)}`));

    await page.locator('#reset').click();
    await expectPose(page, { x: 0, y: 0, z: 0.5 });
    await expect(ball).toHaveAccessibleDescription(/X 0\.000, Y 0\.000, Z 0\.500/);
  });
});
