import {google} from '@better-auth/core/social-providers';
import {authorizationCodeRequest,getOAuth2Tokens,refreshAccessTokenRequest,verifyProviderIdToken,type OAuth2Tokens} from '@better-auth/core/oauth2';
import type {BetterAuthPlugin} from '@better-auth/core';
import {importJWK,type JWK, type JWTHeaderParameters} from 'jose';

const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT='https://www.googleapis.com/oauth2/v3/certs';
const MAX_RESPONSE_BYTES=1024*1024;

export interface GoogleOAuthEgressConfiguration {capability:string;}

function localEgress(config:GoogleOAuthEgressConfiguration){
  if(config.capability.length<32)throw Error('invalid-google-oauth-egress');
  return async(path:'/google/token'|'/google/jwks',init:RequestInit):Promise<Record<string,unknown>>=>{
    const response=await fetch(path==='/google/token'?TOKEN_ENDPOINT:JWKS_ENDPOINT,{...init,redirect:'manual',headers:{...Object.fromEntries(new Headers(init.headers).entries()),'x-riffology-oauth-egress':config.capability}});
    if(response.status>=300&&response.status<400)throw Error('google-oauth-egress-redirect-denied');
    const length=Number(response.headers.get('content-length'));
    if(Number.isFinite(length)&&length>MAX_RESPONSE_BYTES)throw Error('google-oauth-egress-response-too-large');
    const text=await response.text();
    if(new TextEncoder().encode(text).byteLength>MAX_RESPONSE_BYTES)throw Error('google-oauth-egress-response-too-large');
    let data:unknown;try{data=JSON.parse(text);}catch{throw Error('google-oauth-egress-invalid-response');}
    if(!response.ok||!data||typeof data!=='object'||Array.isArray(data))throw Error('google-oauth-egress-upstream-failed');
    return data as Record<string,unknown>;
  };
}

export function egressGoogleProvider(options:{clientId:string;clientSecret:string;egress:GoogleOAuthEgressConfiguration}){
  const request=localEgress(options.egress),base=google({clientId:options.clientId,clientSecret:options.clientSecret,accessType:'online',includeGrantedScopes:false});
  const provider={...base,
    async validateAuthorizationCode({code,codeVerifier,redirectURI}:{code:string;codeVerifier?:string;redirectURI:string}):Promise<OAuth2Tokens>{
      const tokenRequest=await authorizationCodeRequest({code,codeVerifier,redirectURI,options:{clientId:options.clientId,clientSecret:options.clientSecret},tokenEndpoint:TOKEN_ENDPOINT});
      return getOAuth2Tokens(await request('/google/token',{method:'POST',headers:tokenRequest.headers,body:tokenRequest.body}));
    },
    async refreshAccessToken(refreshToken:string):Promise<OAuth2Tokens>{
      const tokenRequest=await refreshAccessTokenRequest({refreshToken,options:{clientId:options.clientId,clientSecret:options.clientSecret},tokenEndpoint:TOKEN_ENDPOINT});
      return getOAuth2Tokens(await request('/google/token',{method:'POST',headers:tokenRequest.headers,body:tokenRequest.body}));
    },
    idToken:{...base.idToken,algorithms:['RS256'],jwks:async(header:JWTHeaderParameters)=>{
      if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid)throw Error('google-jwk-header-invalid');
      const data=await request('/google/jwks',{method:'GET',headers:{accept:'application/json'}}),keys=data.keys;
      if(!Array.isArray(keys))throw Error('google-jwks-invalid');
      const key=keys.find((candidate):candidate is JWK=>!!candidate&&typeof candidate==='object'&&!Array.isArray(candidate)&&(candidate as JWK).kid===header.kid&&(candidate as JWK).kty==='RSA'&&(candidate as JWK).use==='sig'&&(candidate as JWK).alg==='RS256');
      if(!key)throw Error('google-jwk-not-found');
      return importJWK(key,'RS256');
    }},
  };
  const getUserInfo=base.getUserInfo.bind(base);
  provider.getUserInfo=async tokens=>{
    if(!tokens.idToken||!await verifyProviderIdToken(provider,tokens.idToken,tokens.expectedIdTokenNonce))return null;
    return getUserInfo(tokens);
  };
  return provider;
}

export function googleOAuthEgressPlugin(options:{clientId:string;clientSecret:string;egress:GoogleOAuthEgressConfiguration}):BetterAuthPlugin{
  const provider=egressGoogleProvider(options);
  return {id:'riffology-google-oauth-egress',init(ctx){return {context:{socialProviders:[provider,...ctx.socialProviders.filter(item=>item.id!=='google')]}};}};
}
