import { expect, test } from '@playwright/test';
import { expectPose, focusRingPixels, geometry, openPlayground } from './support';

test.describe('keyboard', () => {
  test('arrows step 1 % of the parameter range; Shift, Ctrl and Cmd are 10x finer', async ({ page }) => {
    const ball = await openPlayground(page);
    await ball.focus();
    await page.keyboard.press('ArrowRight');
    await expectPose(page, { x: 0.02, y: 0, z: 0.5 });
    await page.keyboard.press('ArrowDown');
    await expectPose(page, { x: 0.02, y: 0.02 });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expectPose(page, { y: -0.02 });
    await page.keyboard.press('Shift+ArrowRight');
    await expectPose(page, { x: 0.022 });
    await page.keyboard.press('Control+ArrowLeft');
    await page.keyboard.press('Meta+ArrowLeft');
    await expectPose(page, { x: 0.018 });
    await page.keyboard.press('ArrowLeft');
    await expectPose(page, { x: -0.002, y: -0.02, z: 0.5 });
  });

  test('Page Up/Down and Alt+Up/Down change z; Home and 0 reset', async ({ page }) => {
    const ball = await openPlayground(page);
    await ball.focus();
    await page.keyboard.press('PageUp');
    await expectPose(page, { z: 0.51 });
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await expectPose(page, { z: 0.49 });
    await page.keyboard.press('Shift+PageUp');
    await expectPose(page, { z: 0.491 });
    await page.keyboard.press('Alt+ArrowUp');
    await expectPose(page, { x: 0, y: 0, z: 0.501 });
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expectPose(page, { z: 0.5 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('Home');
    await expectPose(page, { x: 0, y: 0, z: 0.5 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('PageDown');
    await expectPose(page, { y: 0.02, z: 0.49 });
    await page.keyboard.press('0');
    await expectPose(page, { x: 0, y: 0, z: 0.5 });
  });

  test('Escape during a drag restores the pre-drag pose', async ({ page }) => {
    const ball = await openPlayground(page);
    await ball.focus();
    await page.keyboard.press('ArrowRight');
    await expectPose(page, { x: 0.02 });
    const g = await geometry(ball);
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.down();
    await page.mouse.move(g.cx + 30, g.cy + 15, { steps: 3 });
    await expectPose(page, { x: 0.02 + 30 / g.travel, y: 15 / g.travel }, 0.002);
    await page.keyboard.press('Escape');
    await expectPose(page, { x: 0.02, y: 0, z: 0.5 });
    await page.mouse.move(g.cx + 60, g.cy + 40, { steps: 3 }); // ignored after cancel
    await page.mouse.up();
    await expectPose(page, { x: 0.02, y: 0, z: 0.5 });
  });

  test('accessible name, role description, instructions and value', async ({ page }) => {
    const ball = await openPlayground(page);
    await expect(ball).toHaveAttribute('role', 'application');
    await expect(ball).toHaveAttribute('aria-roledescription', 'trackball');
    await expect(ball).toHaveAttribute('tabindex', '0');
    await expect(ball).toHaveAccessibleName('Sound-space trackball');
    await expect(ball).toHaveAccessibleDescription(/Neutral\. X 0\.000, Y 0\.000, Z 0\.500 .*Page Up and Page Down/);
    const live = page.locator('[aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await expect(live).toHaveText('');
    await ball.focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    // Announced once, after input settles (debounced), with the app's formatValue.
    await expect(live).toHaveText('PUNCH, 4% intensity. X 0.000, Y -0.040, Z 0.500');
    await expect(ball).toHaveAccessibleDescription(/^PUNCH, 4% intensity\. X 0\.000, Y -0\.040/);
  });

  test('focus ring is visible for keyboard focus only', async ({ page }) => {
    const ball = await openPlayground(page);
    expect(await focusRingPixels(page, ball)).toBe(0);
    await page.locator('#reset').focus();
    await page.keyboard.press('Shift+Tab'); // keyboard focus
    await expect(ball).toBeFocused();
    await expect.poll(() => focusRingPixels(page, ball)).toBeGreaterThan(100);
    const g = await geometry(ball);
    await page.mouse.click(g.cx, g.cy); // pointer focus hides it
    await expect.poll(() => focusRingPixels(page, ball)).toBe(0);
    await page.keyboard.press('ArrowLeft'); // keyboard use shows it again
    await expect.poll(() => focusRingPixels(page, ball)).toBeGreaterThan(100);
    await page.locator('#reset').focus();
    await expect.poll(() => focusRingPixels(page, ball)).toBe(0);
  });
});
