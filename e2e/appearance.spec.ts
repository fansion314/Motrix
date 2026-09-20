import {
  expect,
  launchMotrix,
  test,
  waitForEngineReady,
} from './fixtures/electron-app'

test('appearance scale and Linux tray color apply immediately and survive restart', async ({
  userDataDir,
  rpcPort,
}) => {
  let app = await launchMotrix({ userDataDir, rpcPort })
  const zoomFactors = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((win) =>
        win.webContents.getZoomFactor()
      )
    )
  const mainPage = async () => {
    await expect
      .poll(() =>
        app.windows().some((window) => window.url().includes('w=main'))
      )
      .toBe(true)
    return app.windows().find((window) => window.url().includes('w=main'))!
  }
  try {
    let page = await mainPage()
    await expect(() => waitForEngineReady(page)).toPass({ timeout: 15000 })
    if (
      !(await page
        .getByRole('link', { name: 'Settings', exact: true })
        .isVisible())
    ) {
      await page
        .getByRole('button', { name: 'Toggle sidebar', exact: true })
        .click()
    }
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByText('Appearance', { exact: true }).first().click()
    await page
      .getByRole('spinbutton', { name: 'Interface scale (%)' })
      .fill('125')
    if (process.platform === 'linux') {
      await page.getByRole('combobox', { name: 'Tray icon color' }).click()
      await page
        .getByRole('option', { name: 'Light icon', exact: true })
        .click()
    }
    await expect.poll(zoomFactors).toEqual(expect.arrayContaining([1]))
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(async () =>
        (await zoomFactors()).filter(
          (value) => Math.abs(value - 1.25) > 0.000001
        )
      )
      .toEqual([])
    await app.close()

    app = await launchMotrix({ userDataDir, rpcPort })
    page = await mainPage()
    await expect(() => waitForEngineReady(page)).toPass({ timeout: 15000 })
    await expect
      .poll(async () =>
        (await zoomFactors()).filter(
          (value) => Math.abs(value - 1.25) > 0.000001
        )
      )
      .toEqual([])
    if (
      !(await page
        .getByRole('link', { name: 'Settings', exact: true })
        .isVisible())
    ) {
      await page
        .getByRole('button', { name: 'Toggle sidebar', exact: true })
        .click()
    }
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByText('Appearance', { exact: true }).first().click()
    await expect(
      page.getByRole('spinbutton', { name: 'Interface scale (%)' })
    ).toHaveValue('125')
    if (process.platform === 'linux')
      await expect(
        page.getByRole('combobox', { name: 'Tray icon color' })
      ).toHaveText('Light icon')
    await page
      .getByRole('spinbutton', { name: 'Interface scale (%)' })
      .fill('100')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(async () =>
        (await zoomFactors()).filter((value) => Math.abs(value - 1) > 0.000001)
      )
      .toEqual([])
  } finally {
    await app.close()
  }
})
