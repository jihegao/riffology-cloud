import assert from 'node:assert/strict';
import test from 'node:test';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {egressGoogleProvider} from '../../services/gateway/google-oauth-egress.ts';

const egress={capability:'c'.repeat(43)};

test('local Google provider keeps PKCE token exchange and verifies ID tokens through the constrained egress',async()=>{
  const original=globalThis.fetch,{privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);
  Object.assign(jwk,{kid:'key-a',use:'sig',alg:'RS256'});
  const calls:{url:string;init:RequestInit}[]=[];
  globalThis.fetch=async(input,init)=>{
    calls.push({url:String(input),init:init??{}});
    if(String(input)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'access',token_type:'Bearer',expires_in:3600,id_token:'placeholder'});
    return Response.json({keys:[jwk]});
  };
  try{
    const provider=egressGoogleProvider({clientId:'client-a',clientSecret:'secret-a',egress});
    const tokens=await provider.validateAuthorizationCode({code:'code-a',codeVerifier:'verifier-a',redirectURI:'https://app.example.test/api/auth/callback/google'});
    assert.equal(tokens.accessToken,'access');
    const body=new URLSearchParams(String(calls[0].init.body));
    assert.equal(calls[0].url,'https://oauth2.googleapis.com/token');
    assert.equal(new Headers(calls[0].init.headers).get('x-riffology-oauth-egress'),egress.capability);
    assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('code_verifier'),'verifier-a');assert.equal(body.get('client_id'),'client-a');assert.equal(body.get('client_secret'),'secret-a');
    const now=Math.floor(Date.now()/1000),idToken=await new SignJWT({sub:'subject-a',email:'invite@example.test',email_verified:true,name:'Invite User'}).setProtectedHeader({alg:'RS256',kid:'key-a'}).setIssuer('https://accounts.google.com').setAudience('client-a').setIssuedAt(now).setExpirationTime(now+300).sign(privateKey);
    const info=await provider.getUserInfo({...tokens,idToken});
    assert.equal(info?.data.sub,'subject-a');assert.equal(info?.user.emailVerified,true);
    assert.equal(calls.at(-1)?.url,'https://www.googleapis.com/oauth2/v3/certs');
  }finally{globalThis.fetch=original;}
});

test('Google egress configuration requires an unguessable capability',()=>{
  assert.throws(()=>egressGoogleProvider({clientId:'client-a',clientSecret:'secret-a',egress:{capability:'short'}}),/invalid-google-oauth-egress/);
});
