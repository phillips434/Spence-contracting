const { expect } = require('@playwright/test');

function freshEmail(){
  return `beta_${Date.now()}@example.com`;
}

async function login(page,email,password){
  await page.goto('/');

  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', password);

  await page.click('button:has-text("Login")');
}

async function logout(page){
  const outBtn = page.locator('button:has-text("Out")');

  if(await outBtn.count()){
    await outBtn.click();
  }
}

async function signUp(page){
  const email = freshEmail();
  const password = 'Test1234!';

  await page.goto('/');

  await page.click('text=Create Account');

  await page.fill('#signupEmail', email);
  await page.fill('#signupPassword', password);

  const agree = page.locator('#signupAgreeToggle');

  if(await agree.count()){
    await agree.click();
  }

  await page.click('button:has-text("Create Account")');

  return { email, password };
}

async function assertNoOwnerData(page){
  await expect(
    page.locator('text=Spence Construction')
  ).toHaveCount(0);
}

module.exports = {
  login,
  logout,
  signUp,
  assertNoOwnerData,
  freshEmail
};
