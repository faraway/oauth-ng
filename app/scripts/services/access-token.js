'use strict';

var accessTokenService = angular.module('oauth.accessToken', []);

accessTokenService.factory('AccessToken', ['Storage', '$rootScope', '$location', '$interval', 'IdToken', function(Storage, $rootScope, $location, $interval, IdToken){

  var service = {
    config: null,
    token: null
  },
  hashFragmentKeys = [
    //Oauth2 keys per http://tools.ietf.org/html/rfc6749#section-4.2.2
    'access_token', 'token_type', 'expires_in', 'scope', 'state',
    'error','error_description',
    //Additional OpenID Connect key per http://openid.net/specs/openid-connect-core-1_0.html#ImplicitAuthResponse
    'id_token'
  ];

  /**
   * Returns the access token.
   */
  service.get = function(){
    return this.token;
  };

  /**
   * Sets and returns the access token. It tries (in order) the following strategies:
   * - takes the token from the fragment URI
   * - takes the token from the sessionStorage
   */
  service.set = function(scope){
    this.config = scope || {};
    var hash = null;

    if ($location.hash().indexOf('access_token') > -1) {
      hash = $location.hash();
    }

    //In case we're using ui-router or other modules that can scramble the hash and path
    if ($location.path().indexOf('access_token') > -1) {
      hash = $location.path().substring(1);
    }

    this.setTokenFromString(hash);

    //If hash is present in URL always use it, cuz its coming from oAuth2 provider redirect
    if(null === service.token){
      setTokenFromSession();
    }

    return this.token;
  };

  /**
   * Delete the access token and remove the session.
   * @returns {null}
   */
  service.destroy = function(){
    Storage.delete('token');
    this.token = null;
    return this.token;
  };

  /**
   * Tells if the access token is expired.
   */
  service.expired = function(){
    return (this.token && this.token.expires_at && new Date(this.token.expires_at) < new Date());
  };

  /**
   * Get the access token from a string and save it
   * @param hash
   */
  service.setTokenFromString = function(hash){
    var params = getTokenFromString(hash);

    if(params){
      removeFragment();
      setToken(params);
      setExpiresAt();
      // We have to save it again to make sure expires_at is set
      //  and the expiry event is set up properly
      setToken(this.token);
      $rootScope.$broadcast('oauth:login', service.token);
    }
  };

  /* * * * * * * * * *
   * PRIVATE METHODS *
   * * * * * * * * * */

  /**
   * Set the access token from the sessionStorage.
   */
  var setTokenFromSession = function(){
    var params = Storage.get('token');
    if (params) {
      setToken(params);
    }
  };

  /**
   * Set the access token.
   *
   * @param params
   * @returns {*|{}}
   */
  var setToken = function(params){
    service.token = service.token || {};      // init the token
    angular.extend(service.token, params);      // set the access token params
    setTokenInSession();                // save the token into the session
    setExpiresAtEvent();                // event to fire when the token expires

    return service.token;
  };

  /**
   * Parse the fragment URI and return an object
   * @param hash
   * @returns {{}}
   */
  var getTokenFromString = function(hash){
    var params = {},
        regex = /([^&=]+)=([^&]*)/g,
        m;

    while ((m = regex.exec(hash)) !== null) {
      params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
    }

    //TODO: this is the hack to interact with WSO2's non standard implementation.
    // Remove this block when wall-e(wso2) has its 5.1.0 release
    if (params.access_token && service.config.x509) {
      var request = new XMLHttpRequest();

      //TODO need wall-e to have CORS enabled
      var wsoIdTokenRequest = service.config.site + '/idToken/TokenService?access_token=' + params.access_token;
      request.open('GET', wsoIdTokenRequest, false);
      request.send();

      //change the impl. of verifyIdTokenSig to use X509 certificate
      IdToken.verifyIdTokenSig = function (idtoken) {
        return IdToken.verifyIdTokenSignatureByX509(idtoken, service.config.x509);
      };

      if (request.status === 200) {
        params.id_token = request.responseText;
      } else {
        params.error = 'Failed to fetch id_token'
      }
    }


    // OpenID Connect
    if (params.id_token) {
      try {
        if (IdToken.validateIdToken(params.id_token)) {
          console.log('id_token validated!');
          IdToken.populateIdTokenClaims(params.id_token, params);
        } else {
          params.error = 'Failed to validate id_token';
        }
      } catch (error) {
        params.error = 'Failed to validate id_token: ' + error.message;
      }
      return params;
    }

    // Oauth2
    if(params.access_token || params.error){
      return params;
    }
  };

  /**
   * Save the access token into the session
   */
  var setTokenInSession = function(){
    Storage.set('token', service.token);
  };

  /**
   * Set the access token expiration date (useful for refresh logics)
   */
  var setExpiresAt = function(){
    if (!service.token) {
      return;
    }
    if(typeof(service.token.expires_in) !== 'undefined' && service.token.expires_in !== null) {
      var expires_at = new Date();
      expires_at.setSeconds(expires_at.getSeconds() + parseInt(service.token.expires_in)-60); // 60 seconds less to secure browser and response latency
      service.token.expires_at = expires_at;
    }
    else {
      service.token.expires_at = null;
    }
  };


  /**
   * Set the timeout at which the expired event is fired
   */
  var setExpiresAtEvent = function(){
    // Don't bother if there's no expires token
    if (typeof(service.token.expires_at) === 'undefined' || service.token.expires_at === null) {
      return;
    }
    var time = (new Date(service.token.expires_at))-(new Date());
    if(time && time > 0){
      $interval(function(){
        $rootScope.$broadcast('oauth:expired', service.token);
      }, time, 1);
    }
  };

  /**
   * Remove the oAuth2 pieces from the hash fragment
   */
  var removeFragment = function(){
    var curHash = $location.hash();
    angular.forEach(hashFragmentKeys,function(hashKey){
      var re = new RegExp('&'+hashKey+'(=[^&]*)?|^'+hashKey+'(=[^&]*)?&?');
      curHash = curHash.replace(re,'');
    });

    $location.hash(curHash);
  };

  return service;

}]);
